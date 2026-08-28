import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { buildStorageKey, uploadFile } from "@/lib/storage";
import { extractText } from "@/lib/extract";
import { convertToPdf, isConvertible } from "@/lib/officeConvert";
import { logAudit } from "@/lib/audit";
import { notifyManagerReviewNeeded } from "@/lib/notify";
import { DUPLICATE_REASON } from "@/lib/duplicates";
import { validateFileMatchesDocType } from "@/lib/fileTypeValidation";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

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

  try {
    assertCan(user.role, "editOwnUpload");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { category: true, versions: true },
  });

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
  const previousReviewers = [...new Map(previousRoundRequests.map((r) => [r.reviewerId, r.reviewer])).values()].filter(
    (r) => r.isActive && r.role === "manager" && r.id !== user.id
  );
  if (previousReviewers.length === 0) {
    return NextResponse.json(
      { error: "Could not find any active reviewers from the previous round to send this to — ask a manager to reassign a reviewer first." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const typeError = validateFileMatchesDocType(buffer, file.name, doc.docType);
  if (typeError) {
    return NextResponse.json({ error: typeError }, { status: 400 });
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
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

  // Re-evaluate the content-duplicate flag against this new file too —
  // "changes to the doc" (a new version, same as a title edit on PATCH)
  // should re-run duplicate detection, not just the original upload.
  const contentMatch = await prisma.documentVersion.findFirst({
    where: { checksum, documentId: { not: doc.id }, document: { deletedAt: null } },
    include: { document: true },
  });
  const wasContentDuplicate = doc.duplicateReason === DUPLICATE_REASON.content;
  let duplicateUpdate: Partial<{ duplicateOfId: string | null; duplicateReason: string | null }> = {};
  if (contentMatch) {
    duplicateUpdate = { duplicateOfId: contentMatch.document.id, duplicateReason: DUPLICATE_REASON.content };
  } else if (wasContentDuplicate) {
    duplicateUpdate = { duplicateOfId: null, duplicateReason: null };
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
  // Deliberately no whole-team notification here — see lib/notify.ts:
  // routine pre-publish status doesn't reach the shared channels. Each
  // reassigned reviewer still gets a targeted action-item alert, though.
  for (const reviewer of previousReviewers) {
    await notifyManagerReviewNeeded({
      documentTitle: doc.title,
      documentId: doc.id,
      categoryName: doc.category.name,
      uploaderName: user.name,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      reviewerEmail: reviewer.email,
      isNewVersion: true,
      versionNumber: nextVersionNumber,
    });
  }

  // { id, versionNumber } only — the full record has fileSize as a
  // Prisma BigInt, which NextResponse.json() can't JSON-stringify.
  return NextResponse.json(
    { version: { id: version.id, versionNumber: version.versionNumber } },
    { status: 201 }
  );
}
