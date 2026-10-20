import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { buildStorageKey, uploadFile } from "@/lib/storage";
import { extractText } from "@/lib/extract";
import { convertToPdf, isConvertible } from "@/lib/officeConvert";
import { logAudit } from "@/lib/audit";
import { notifyManagerReviewNeeded, notifyNewVersionAvailable, fireNotification } from "@/lib/notify";
import { indexDocument } from "@/lib/search";
import { computeRoundAttempts } from "@/lib/versionRounds";
import { DUPLICATE_REASON } from "@/lib/duplicates";
import { validateFileMatchesDocType } from "@/lib/fileTypeValidation";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  canBypassReviewFor,
  contributesToTeam,
  documentAccessWhere,
  eligibleReviewerWhere,
  passesTeamGate,
  usersWhoCanSeeWhere,
} from "@/lib/access";

// POST /api/documents/:id/versions — upload a new version of an existing
// document. Publishing an update still requires review, same as a
// brand-new upload — old version stays live/visible until the new one
// is approved, so users never see a broken/missing doc mid-review.
//
// The reviewer(s) aren't picked here — a replace goes back to EVERYONE who
// was a reviewer in the previous round (the highest roundNumber so far),
// not just one of them, so a multi-approver loop (add-reviewers / "get a
// 2nd/3rd opinion" — see app/api/documents/[id]/review/route.ts) stays
// intact across a resubmission instead of collapsing back down to a single
// reviewer. This deliberately does NOT fall back to document.ownerId (the
// reviewer picked at the very first upload): that field never changes, and
// since it's also what the self-review guard checks (isOwnDocument in
// app/dashboard/documents/[id]/page.tsx), always routing back to it caused
// reviewers to look like they were reviewing their own document. Pick
// someone else instead via Reassign on the document page if the usual
// reviewer(s) shouldn't be the ones this time.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { category: true, versions: true, teamAccess: { select: { teamId: true } }, duplicateOf: true },
  });

  // The org role allows editing, or (for a team document) a contributor or
  // manager role in one of its teams does.
  const teamCanEdit = doc.visibility === "restricted" && doc.teamAccess.some((a) => contributesToTeam(user, a.teamId));
  if (!can(user.role, "editOwnUpload") && !teamCanEdit) {
    return NextResponse.json({ error: `Forbidden: role "${user.role}" cannot "editOwnUpload"` }, { status: 403 });
  }

  if (doc.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted" }, { status: 400 });
  }

  // A version already awaiting a decision blocks any further version
  // uploads until that one is resolved (approved or rejected) — otherwise
  // multiple versions could pile up mid-review with no clear single "the
  // one under review" for a reviewer to act on.
  if (doc.status === "pending_review") {
    return NextResponse.json(
      { error: "A version of this document is already under review. Wait for it to be approved or rejected before uploading another." },
      { status: 409 }
    );
  }

  // Once rejected, only whoever uploaded the specific version that got
  // rejected can replace it and resubmit — not just any manager/superadmin,
  // matching the tightened rule in app/dashboard/documents/[id]/page.tsx
  // (canUploadVersion) that hides the "Upload New Version" button from
  // everyone else in that case. Re-checked here since the button being
  // hidden doesn't stop a direct API call.
  if (doc.status === "rejected") {
    const latestVersion = doc.versions.reduce((latest, v) => (v.versionNumber > latest.versionNumber ? v : latest));
    if (latestVersion.uploadedById !== user.id) {
      return NextResponse.json(
        { error: "Only the person who uploaded the rejected version can replace it." },
        { status: 403 }
      );
    }
  }

  const form = await req.formData();
  const file = form.get("file") as File;
  const changelog = form.get("changelog") as string;
  const confirmDuplicate = form.get("confirmDuplicate") === "true";
  const confirmedDuplicateOfId = form.get("duplicateOfId") as string | null;
  // "No review needed" (manager only): publish this version directly, same
  // as the upload form's option. Labels the document Review Bypassed.
  const bypassReview = form.get("bypassReview") === "true";
  // Picked by the uploader only when nobody from the previous round can
  // review this version (see needsReviewer below).
  const chosenReviewerId = (form.get("reviewerId") as string | null) || null;

  if (bypassReview && !canBypassReviewFor(user, doc.visibility, doc.teamAccess.map((a) => a.teamId))) {
    return NextResponse.json(
      {
        error:
          doc.visibility === "restricted"
            ? "Only a manager of every team this document is restricted to can publish it without review."
            : "Only a manager can publish without review.",
      },
      { status: 403 }
    );
  }

  const maxRoundSoFar = await prisma.reviewRequest.aggregate({
    where: { documentId: doc.id },
    _max: { roundNumber: true },
  });
  const previousRoundRequests = maxRoundSoFar._max.roundNumber
    ? await prisma.reviewRequest.findMany({
        where: { documentId: doc.id, roundNumber: maxRoundSoFar._max.roundNumber },
        include: { reviewer: true },
      })
    : [];
  // Still eligible today (lib/access.ts): an active org manager, or for a
  // restricted document a manager of one of its teams.
  const previousIds = [...new Set(previousRoundRequests.map((r) => r.reviewerId))].filter((id) => id !== user.id && id !== doc.uploadedById);
  const eligiblePrevious = new Set(
    (
      await prisma.user.findMany({
        where: { AND: [{ id: { in: previousIds } }, eligibleReviewerWhere(doc)] },
        select: { id: true },
      })
    ).map((u) => u.id)
  );
  let previousReviewers = [...new Map(previousRoundRequests.map((r) => [r.reviewerId, r.reviewer])).values()].filter((r) =>
    eligiblePrevious.has(r.id)
  );
  // Nobody left from last round: a document published with "No review
  // needed" (its only reviewer is the manager who published it), or every
  // previous reviewer has left or lost access. The uploader picks one.
  if (!bypassReview && previousReviewers.length === 0) {
    const chosen =
      chosenReviewerId && chosenReviewerId !== user.id && chosenReviewerId !== doc.uploadedById
        ? await prisma.user.findFirst({ where: { AND: [{ id: chosenReviewerId }, eligibleReviewerWhere(doc)] } })
        : null;
    if (!chosen) {
      return NextResponse.json(
        { error: "Nobody from the previous review round can review this version. Choose a reviewer.", needsReviewer: true },
        { status: 400 }
      );
    }
    previousReviewers = [chosen];
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const typeError = validateFileMatchesDocType(buffer, file.name, doc.docType);
  if (typeError) {
    return NextResponse.json({ error: typeError }, { status: 400 });
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  // Duplicate check — before any storage write or DB row for this version,
  // same "screen before committing" rule the fresh-upload route (POST
  // /api/documents) already applies, rather than creating the version first
  // and only flagging it as a duplicate after the fact. Content-only here
  // (unlike the fresh-upload route's content-or-title check): this is a new
  // FILE for an EXISTING document, so its title never changes and was never
  // itself in question. Can be force-uploaded past with confirmDuplicate,
  // same as a fresh upload, which re-derives the match server-side rather
  // than trusting the client's claim of which document it matched.
  // Only documents this uploader can see, so the warning never reveals the
  // title of another team's restricted document.
  const contentMatch = await prisma.documentVersion.findFirst({
    where: { checksum, documentId: { not: doc.id }, document: { AND: [{ deletedAt: null }, documentAccessWhere(user)] } },
    include: { document: true },
  });
  if (contentMatch && !(confirmDuplicate && confirmedDuplicateOfId === contentMatch.document.id)) {
    return NextResponse.json(
      {
        duplicate: {
          documentId: contentMatch.document.id,
          title: contentMatch.document.title,
          reason: DUPLICATE_REASON.content,
        },
      },
      { status: 409 }
    );
  }
  const wasContentDuplicate = doc.duplicateReason === DUPLICATE_REASON.content;
  let duplicateUpdate: Partial<{ duplicateOfId: string | null; duplicateReason: string | null }> = {};
  if (contentMatch) {
    duplicateUpdate = { duplicateOfId: contentMatch.document.id, duplicateReason: DUPLICATE_REASON.content };
  } else if (wasContentDuplicate) {
    duplicateUpdate = { duplicateOfId: null, duplicateReason: null };
  }

  const nextVersionNumber = Math.max(...doc.versions.map((v) => v.versionNumber)) + 1;
  const storageKey = buildStorageKey(
    doc.category.name.toLowerCase().replace(/\s+/g, "-"),
    doc.id,
    file.name
  );

  const [extractedText, , pdfBuffer] = await Promise.all([
    extractText(buffer, file.name),
    uploadFile(storageKey, buffer, file.type),
    isConvertible(file.name) ? convertToPdf(buffer, file.name) : Promise.resolve(null),
  ]);

  let previewPdfPath: string | null = null;
  if (pdfBuffer) {
    previewPdfPath = `${storageKey}.preview.pdf`;
    await uploadFile(previewPdfPath, pdfBuffer, "application/pdf");
  }

  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: nextVersionNumber,
      filePath: storageKey,
      originalFilename: file.name,
      fileSize: BigInt(buffer.length),
      checksum,
      changelog,
      extractedText,
      previewPdfPath,
      uploadedById: user.id,
    },
  });

  if (bypassReview) {
    return publishBypassedVersion(user, doc, version, duplicateUpdate, (maxRoundSoFar._max.roundNumber ?? 0) + 1);
  }

  // Document goes back to pending_review for the new version, but keeps
  // its previous currentVersionId until the new one is approved — the
  // live/searchable copy stays the last-approved version throughout.
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: "pending_review", ...duplicateUpdate },
  });

  // A fresh round, not round 1 again — matters most when this version
  // upload is a resubmission after a rejection: without bumping the round,
  // the new pending request would share roundNumber with the old rejected
  // one, and the Review Trail (app/dashboard/documents/[id]/ReviewTrail.tsx)
  // would keep reading that round as "rejected" forever, even once this
  // resubmission is approved.
  const nextRound = (maxRoundSoFar._max.roundNumber ?? 0) + 1;

  await prisma.reviewRequest.createMany({
    data: previousReviewers.map((reviewer) => ({
      documentId: doc.id,
      requestedById: user.id,
      reviewerId: reviewer.id,
      roundNumber: nextRound,
    })),
  });

  await logAudit({ userId: user.id, action: "upload", documentId: doc.id, documentTitle: doc.title });

  // The label for the version just created above — doc.versions (fetched
  // before this upload) doesn't include it yet, and reviewRequest.createMany
  // doesn't return the rows it created, so both need a fresh read of what
  // this upload itself just wrote.
  const labelReviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId: doc.id },
    select: { roundNumber: true, status: true, comments: true, createdAt: true },
  });
  const versionLabel = computeRoundAttempts(
    [...doc.versions, version].map((v) => ({ id: v.id, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt })),
    labelReviewRequests,
    doc.revokedAt
  ).byVersionId.get(version.id)?.label;

  // Deliberately no whole-team notification here — see lib/notify.ts:
  // routine pre-publish status doesn't reach the shared channels. Each
  // reassigned reviewer still gets a targeted action-item alert, though.
  fireNotification(
    Promise.all(
      previousReviewers.map((reviewer) =>
        notifyManagerReviewNeeded({
          documentTitle: doc.title,
          documentId: doc.id,
          categoryName: doc.category.name,
          uploaderName: user.name,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          reviewerEmail: reviewer.email,
          isNewVersion: true,
          versionLabel,
        })
      )
    )
  );

  // { id, versionNumber } only — the full record has fileSize as a
  // Prisma BigInt, which NextResponse.json() can't JSON-stringify.
  return NextResponse.json(
    { version: { id: version.id, versionNumber: version.versionNumber } },
    { status: 201 }
  );
}

// "No review needed" for a new version: publishes it straight away and
// records the bypass as an already-approved review round by the uploading
// manager, exactly like a bypassed fresh upload (app/api/documents/route.ts),
// so version labels, approval checks and the review trail all keep working.
async function publishBypassedVersion(
  user: { id: string; name: string },
  doc: {
    id: string;
    title: string;
    tags: string[];
    docType: string;
    visibility: "org" | "restricted";
    uploadedById: string;
    revokedAt: Date | null;
    category: { name: string };
    duplicateOf: { title: string } | null;
    teamAccess: { teamId: string }[];
    versions: { id: string; versionNumber: number; uploadedAt: Date }[];
  },
  version: { id: string; versionNumber: number; uploadedAt: Date; extractedText: string | null; previewPdfPath: string | null },
  duplicateUpdate: Partial<{ duplicateOfId: string | null; duplicateReason: string | null }>,
  nextRound: number
) {
  const [, published] = await prisma.$transaction([
    prisma.reviewRequest.create({
      data: {
        documentId: doc.id,
        requestedById: user.id,
        reviewerId: user.id,
        roundNumber: nextRound,
        status: "approved",
        comments: "Review bypassed: published directly by the uploading manager.",
        resolvedAt: new Date(),
      },
    }),
    prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "published",
        currentVersionId: version.id,
        reviewBypassed: true,
        lastReviewedAt: new Date(),
        ...duplicateUpdate,
      },
      include: { duplicateOf: true },
    }),
  ]);

  await indexDocument({
    id: doc.id,
    title: doc.title,
    tags: doc.tags,
    categoryName: doc.category.name,
    docType: doc.docType,
    status: "published",
    extractedText: version.extractedText ?? "",
    uploadedByName: user.name,
    isStale: false,
    updatedAt: published.updatedAt.toISOString(),
    duplicateOfTitle: published.duplicateOf?.title ?? null,
    hasPreviewPdf: Boolean(version.previewPdfPath),
  });
  await logAudit({ userId: user.id, action: "upload_review_bypassed", documentId: doc.id, documentTitle: doc.title });

  // Same courtesy as a reviewed publish (app/api/documents/[id]/review/
  // route.ts): people holding an older copy, who can still see it, hear
  // there's a new one.
  const priorDownloaders = await prisma.auditLog.findMany({
    where: {
      documentId: doc.id,
      action: "download",
      userId: { not: user.id },
      user: { AND: [{ isActive: true }, usersWhoCanSeeWhere(doc)] },
    },
    distinct: ["userId"],
    select: { user: { select: { email: true, name: true } } },
  });
  if (priorDownloaders.length > 0) {
    const reviewRequests = await prisma.reviewRequest.findMany({
      where: { documentId: doc.id },
      select: { roundNumber: true, status: true, comments: true, createdAt: true },
    });
    const versionLabel =
      computeRoundAttempts([...doc.versions, version], reviewRequests, doc.revokedAt).byVersionId.get(version.id)?.label ??
      `v${version.versionNumber}`;
    fireNotification(
      notifyNewVersionAvailable({
        documentTitle: doc.title,
        documentId: doc.id,
        versionLabel,
        recipients: priorDownloaders.map((d) => d.user),
      })
    );
  }

  return NextResponse.json({ version: { id: version.id, versionNumber: version.versionNumber } }, { status: 201 });
}

