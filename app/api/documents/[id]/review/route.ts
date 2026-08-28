import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { indexDocument } from "@/lib/search";
import { logAudit } from "@/lib/audit";
import { notifyReviewDecision, notifyDocumentPublished, notifyReviewerAssigned, notifyNewVersionAvailable } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/review
//
// Every action below requires the caller to hold an ACTIVE (status
// "pending") ReviewRequest row for this document — i.e. they were actually
// assigned to review it, whether that's the reviewer picked at upload time,
// someone it was reassigned to, or someone added for a second/third
// opinion. There's no "any manager can act on any pending doc" fallback:
// once a document has specific tracked reviewers, only they can move it.
//
//   { action: "decide", decision: "approved"|"rejected", comments?, announceToAll?, versionId? }
//     The original approve/reject. Approving your own upload/ownership is
//     blocked — reassign instead. If OTHER reviewers still have pending
//     rows for this document (added via add-reviewers, or this is a
//     multi-reviewer round), an approval here is recorded but the document
//     doesn't actually publish until every pending row is approved. A
//     rejection immediately rejects the whole document and auto-closes any
//     other still-pending sibling rows — see reject handling below.
//   { action: "reassign", newReviewerId }
//     Hands YOUR row to someone else entirely — for "I can't/shouldn't be
//     the one reviewing this" (e.g. you're the uploader) or "this should
//     really go to my manager." Same round, new reviewer.
//   { action: "add-reviewers", reviewerIds: string[] }
//     Keeps your own row as-is, and additionally assigns the given
//     reviewer(s) in a new round — "I want a second/third opinion." The
//     document needs ALL of them (plus your own row, if still pending) to
//     approve before it publishes.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Belt-and-suspenders alongside the per-request ownership check below:
  // every reviewerId is only ever set to an active manager at assignment
  // time (validateReassignTarget), but a role change *after* assignment
  // (e.g. demoted to contributor) shouldn't let a stale assignment keep
  // acting as if approveReview still applies to them. Deliberately excludes
  // superadmin too, same as the rest of this app's review gate.
  if (user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden: only managers can act on a review." }, { status: 403 });
  }

  const body = await req.json();
  const action: string = body.action ?? "decide";

  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  // Undo acts on an already-APPROVED row, not a pending one — handled before
  // the pending-row guard below, which would otherwise always reject it.
  if (action === "undo-approval") {
    if (document.status !== "pending_review") {
      return NextResponse.json(
        { error: "This document has already moved past review — your approval can no longer be undone." },
        { status: 400 }
      );
    }
    const myApproval = await prisma.reviewRequest.findFirst({
      where: { documentId: params.id, reviewerId: user.id, status: "approved" },
    });
    if (!myApproval) {
      return NextResponse.json({ error: "You don't have an approval on this document to undo." }, { status: 403 });
    }
    await prisma.reviewRequest.update({
      where: { id: myApproval.id },
      data: { status: "pending", comments: null, resolvedAt: null },
    });
    await logAudit({ userId: user.id, action: "undo_approval", documentId: document.id, documentTitle: document.title });
    return NextResponse.json({ ok: true });
  }

  const myRequest = await prisma.reviewRequest.findFirst({
    where: { documentId: params.id, reviewerId: user.id, status: "pending" },
  });
  if (!myRequest) {
    return NextResponse.json(
      { error: "You don't currently have an active review assignment for this document." },
      { status: 403 }
    );
  }

  if (action === "reassign") {
    const { newReviewerId } = body;
    const error = await validateReassignTarget(newReviewerId, document, user.id);
    if (error) return NextResponse.json({ error }, { status: 400 });

    // Otherwise they'd end up holding two separate pending rows for the
    // same document (this one, plus whatever other round they're already
    // in) — awkward to resolve since each API call only acts on one row.
    const alreadyHasOne = await prisma.reviewRequest.findFirst({
      where: { documentId: document.id, reviewerId: newReviewerId, status: "pending" },
    });
    if (alreadyHasOne) {
      return NextResponse.json(
        { error: "That person already has an active review assignment for this document." },
        { status: 400 }
      );
    }

    await prisma.reviewRequest.update({ where: { id: myRequest.id }, data: { reviewerId: newReviewerId } });
    await logAudit({ userId: user.id, action: "reassign_review", documentId: document.id, documentTitle: document.title });

    const newReviewer = await prisma.user.findUniqueOrThrow({ where: { id: newReviewerId } });
    await notifyReviewerAssigned({
      documentTitle: document.title,
      documentId: document.id,
      reviewerId: newReviewerId,
      reviewerName: newReviewer.name,
      assignedByName: user.name,
      reason: "reassigned",
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "add-reviewers") {
    const { reviewerIds } = body;
    if (!Array.isArray(reviewerIds) || reviewerIds.length === 0) {
      return NextResponse.json({ error: "Pick at least one reviewer to add." }, { status: 400 });
    }
    const uniqueIds = [...new Set(reviewerIds as string[])];
    for (const id of uniqueIds) {
      const error = await validateReassignTarget(id, document, user.id);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    // Don't re-add someone who already has an active pending row for this
    // document (e.g. picked twice, or already reassigned in from before).
    const alreadyPending = await prisma.reviewRequest.findMany({
      where: { documentId: document.id, status: "pending", reviewerId: { in: uniqueIds } },
      select: { reviewerId: true },
    });
    const alreadyPendingIds = new Set(alreadyPending.map((r) => r.reviewerId));
    const toAdd = uniqueIds.filter((id) => !alreadyPendingIds.has(id));
    if (toAdd.length === 0) {
      return NextResponse.json({ error: "Everyone picked already has an active review assignment for this document." }, { status: 400 });
    }

    const maxRound = await prisma.reviewRequest.aggregate({
      where: { documentId: document.id },
      _max: { roundNumber: true },
    });
    const nextRound = (maxRound._max.roundNumber ?? 1) + 1;

    await prisma.reviewRequest.createMany({
      data: toAdd.map((reviewerId) => ({
        documentId: document.id,
        requestedById: user.id,
        reviewerId,
        roundNumber: nextRound,
      })),
    });

    const newReviewers = await prisma.user.findMany({ where: { id: { in: toAdd } } });
    for (const r of newReviewers) {
      await notifyReviewerAssigned({
        documentTitle: document.title,
        documentId: document.id,
        reviewerId: r.id,
        reviewerName: r.name,
        assignedByName: user.name,
        reason: "second_opinion",
      });
    }
    await logAudit({ userId: user.id, action: "request_second_opinion", documentId: document.id, documentTitle: document.title });

    return NextResponse.json({ ok: true, added: toAdd.length });
  }

  if (action !== "decide") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { decision, comments, announceToAll, versionId } = body;
  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }
  if (decision === "approved" && typeof announceToAll !== "boolean") {
    return NextResponse.json(
      { error: "announceToAll must be true or false — choose whether to notify all users before approving." },
      { status: 400 }
    );
  }
  if (decision === "approved" && document.uploadedById === user.id) {
    return NextResponse.json(
      { error: "You can't approve your own document — reassign it to another reviewer instead." },
      { status: 400 }
    );
  }

  await prisma.reviewRequest.update({
    where: { id: myRequest.id },
    data: { status: decision, comments, resolvedAt: new Date() },
  });

  if (decision === "rejected") {
    // Any other reviewer still holding a pending row for this document
    // (a parallel second/third opinion in flight) is moot now — the
    // document's rejected outright, so close those out too rather than
    // leaving them dangling forever as actionable-looking pending requests.
    await prisma.reviewRequest.updateMany({
      where: { documentId: document.id, status: "pending" },
      data: { status: "rejected", comments: "Auto-closed: this document was rejected by another reviewer.", resolvedAt: new Date() },
    });

    const rejected = await prisma.document.update({
      where: { id: document.id },
      data: { status: "rejected", lastReviewedAt: new Date() },
      include: { uploadedBy: true },
    });

    await logAudit({ userId: user.id, action: "reject", documentId: rejected.id, documentTitle: rejected.title });
    await notifyReviewDecision({
      uploaderName: rejected.uploadedBy.name,
      uploaderEmail: rejected.uploadedBy.email,
      documentTitle: rejected.title,
      documentId: rejected.id,
      decision: "rejected",
      comments,
    });

    return NextResponse.json({ document: { id: rejected.id, status: rejected.status } });
  }

  // Approved: only actually publish once every OTHER pending row for this
  // document (parallel reviewers from add-reviewers) has also approved —
  // "second/third opinion" isn't real unless everyone's sign-off is required.
  const stillPending = await prisma.reviewRequest.count({
    where: { documentId: document.id, status: "pending" },
  });
  if (stillPending > 0) {
    return NextResponse.json({
      document: { id: document.id, status: document.status },
      waitingOnOthers: true,
    });
  }

  // On approval, promote a version to "current" — this is what makes the
  // review gate meaningful for version updates, not just first uploads: the
  // old version stays live/searchable until this point. Defaults to the
  // newest upload, but the reviewer can pick an earlier one instead (e.g. a
  // critical rollback where the latest upload turns out to be wrong) — if
  // they do, versionId must actually belong to this document. Skipped
  // entirely for a link document (docType "link") — it has no versions,
  // just externalUrl, so there's nothing to promote.
  let currentVersionId: string | undefined;
  if (!document.externalUrl) {
    if (versionId) {
      const chosenVersion = await prisma.documentVersion.findFirstOrThrow({
        where: { id: versionId, documentId: params.id },
      });
      currentVersionId = chosenVersion.id;
    } else {
      const latestVersion = await prisma.documentVersion.findFirstOrThrow({
        where: { documentId: params.id },
        orderBy: { versionNumber: "desc" },
      });
      currentVersionId = latestVersion.id;
    }
  }

  const published = await prisma.document.update({
    where: { id: params.id },
    data: {
      status: "published",
      lastReviewedAt: new Date(),
      ...(currentVersionId ? { currentVersionId } : {}),
    },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });

  await indexDocument({
    id: published.id,
    title: published.title,
    tags: published.tags,
    categoryName: published.category.name,
    docType: published.docType,
    status: published.status,
    extractedText: published.currentVersion?.extractedText ?? "",
    uploadedByName: published.uploadedBy.name,
    isStale: false,
    updatedAt: published.updatedAt.toISOString(),
    duplicateOfTitle: published.duplicateOf?.title ?? null,
    hasPreviewPdf: Boolean(published.currentVersion?.previewPdfPath),
  });

  await logAudit({ userId: user.id, action: "approve", documentId: published.id, documentTitle: published.title });

  await notifyReviewDecision({
    uploaderName: published.uploadedBy.name,
    uploaderEmail: published.uploadedBy.email,
    documentTitle: published.title,
    documentId: published.id,
    decision: "approved",
    comments,
  });

  // Broadcast to the whole org on publish — separate from the uploader's
  // decision notice above, which they already got. Excludes the uploader
  // here to avoid a duplicate notification for the same event. Only fires
  // if the reviewing manager explicitly chose "Yes" (see announceToAll
  // validation above — this can never be silently skipped).
  if (announceToAll === true) {
    const recipients = await prisma.user.findMany({
      where: { isActive: true, id: { not: published.uploadedById } },
      select: { id: true, name: true },
    });
    await notifyDocumentPublished({
      documentTitle: published.title,
      documentId: published.id,
      categoryName: published.category.name,
      uploaderName: published.uploadedBy.name,
      recipients,
    });
  }

  // Separate from the announceToAll broadcast above — a targeted courtesy
  // to people who already have a (now outdated) copy of this specific
  // document, regardless of whether the manager chose to announce it more
  // broadly. Only meaningful once there's an actual version to name; a
  // link document (docType "link") has no versions. Naturally sends to
  // nobody on a document's first-ever publish, since nobody could have
  // downloaded a "previous" version of it yet.
  if (published.currentVersion) {
    const priorDownloaders = await prisma.auditLog.findMany({
      where: { documentId: published.id, action: "download", userId: { not: published.uploadedById } },
      distinct: ["userId"],
      select: { user: { select: { email: true, name: true } } },
    });
    if (priorDownloaders.length > 0) {
      await notifyNewVersionAvailable({
        documentTitle: published.title,
        documentId: published.id,
        versionNumber: published.currentVersion.versionNumber,
        recipients: priorDownloaders.map((d) => d.user),
      });
    }
  }

  // { id, status } only — the full record's currentVersion.fileSize is a
  // Prisma BigInt, which NextResponse.json() can't JSON-stringify (the
  // caller, ReviewActions, doesn't read the body anyway — it just refreshes).
  return NextResponse.json({ document: { id: published.id, status: published.status } });
}

/** Shared validation for both "reassign" and "add-reviewers" targets: must
 * be a real, active manager, not the caller, and not the document's
 * uploader (that would just recreate the self-review problem via a
 * different door). Deliberately does NOT exclude document.ownerId — that's
 * the reviewer picked at upload time (see app/api/documents/route.ts's
 * ownerId comment), not the uploader, and it never changes on reassignment,
 * so excluding it here would permanently lock that reviewer out of ever
 * being reassigned back or added for a second opinion on their own document.
 * Returns an error message, or null if it's fine. */
async function validateReassignTarget(
  targetId: unknown,
  document: { uploadedById: string },
  callerId: string
): Promise<string | null> {
  if (typeof targetId !== "string" || !targetId) return "A reviewer is required.";
  if (targetId === callerId) return "Pick someone other than yourself.";
  if (targetId === document.uploadedById) {
    return "That person uploaded this document and can't review their own submission.";
  }
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || !target.isActive || target.role !== "manager") {
    return "That person isn't an active manager.";
  }
  return null;
}
