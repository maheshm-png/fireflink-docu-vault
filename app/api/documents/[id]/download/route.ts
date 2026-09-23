import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getDownloadUrl, getFileBuffer } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { addWatermark } from "@/lib/watermark";
import { computeRoundAttempts, everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

const WATERMARKED_DOC_TYPES = new Set(["doc", "ppt", "excel"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// The downloaded filename embeds the document title + its Round.Attempt
// label (e.g. "My Policy (v1.1).pdf") instead of just whatever the
// uploader originally named the file — the original name is often
// something like "final_v2_reviewed.docx" that says nothing about which
// reviewed attempt this actually is once it's sitting in someone's
// Downloads folder next to three other versions of the same document.
function safeFilenameFromTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "document";
}
function buildDownloadFilename(title: string, label: string, ext: string): string {
  return `${safeFilenameFromTitle(title)} (${label}).${ext}`;
}

// GET /api/documents/:id/download?version=3 (omit for current/published version)
//
// Every active user (Manager, SC, BD, and view-only Other alike) can reach
// this route and download a *published* document — download is part of
// "view access," same as seeing it in the dashboard. But only the actual
// current live version is ever downloadable, by anyone, regardless of role
// — an older approved version, the newest upload while it's still pending
// review, or a rejected attempt are all view-only now (see /preview for
// that instead). Reviewers/contributors still need to look at those while
// deciding, they just can't download a copy of them.
//
// The file is served byte-for-byte from storage via a redirect to a
// presigned URL — nothing here re-encodes, re-compresses, or otherwise
// touches the file, so PPT layout, video quality, and PDF formatting are
// preserved exactly as uploaded.
//
// The base view-only "user" role downloading a Word/PPT/Excel file in its
// original format gets a Fireflink-logo-watermarked copy (lib/watermark.ts)
// instead of the clean file — contributors, managers, and superadmin are
// unaffected. That can't be a redirect to a presigned URL since the bytes
// are generated on the fly, so this branch streams the watermarked buffer
// directly instead.
//
// ?format=pdf|original (either role's default is "original" when omitted)
// — every role can choose to download the LibreOffice-converted PDF instead
// of the original, when one exists (hasPreviewPdf). The PDF is never
// watermarked (it isn't the editable original the "user"-role restriction
// cares about) and isn't restricted to any particular role.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const versionParam = req.nextUrl.searchParams.get("version");
  const format = req.nextUrl.searchParams.get("format");

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { currentVersion: true, versions: true },
  });

  // Soft-deleted docs are off-limits until restored, even for managers —
  // restore first if you need to look at the content again.
  if (document.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId: document.id },
    select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewerId: true },
  });

  // Same "is there a real, currently-live approved version" check the
  // dashboard page uses (app/dashboard/documents/[id]/page.tsx's
  // hasEverPublished/isPubliclyVisible): a document simply back in
  // re-review after already being published once (status pending_review or
  // rejected) must stay downloadable to everyone, same as it stays visible
  // there. Checking the raw document.status === "published" here would 404
  // a document the dashboard just showed as accessible.
  const hasEverPublished =
    document.currentVersionId !== null &&
    everApprovedVersionIds(document.versions, reviewRequests, document.revokedAt).has(document.currentVersionId);
  const isPubliclyVisible = hasEverPublished && document.status !== "revoked" && document.status !== "archived";

  // Uploader/owner/an assigned reviewer (any round)/superadmin, same
  // narrower rule as app/dashboard/documents/[id]/page.tsx's
  // canSeeUnpublishedDoc — a manager with no assignment on this document
  // can't download it early either.
  const canAccessUnpublished =
    isPubliclyVisible ||
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    reviewRequests.some((r) => r.reviewerId === user.id) ||
    user.role === "superadmin";

  if (!canAccessUnpublished) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const version = versionParam
    ? document.versions.find((v) => v.versionNumber === parseInt(versionParam, 10))
    : document.currentVersion;

  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  // Only the current live version can ever be downloaded — enforced here
  // (not just by omitting the UI control) since ?version= is a plain query
  // param anyone could add by hand. Applies to every role: a manager or the
  // uploader reviewing a fresh upload can still PREVIEW it (/preview has no
  // such restriction), just not download a copy until it's actually
  // published and becomes the current version.
  if (document.currentVersionId !== version.id) {
    return NextResponse.json({ error: "Only the current version is available to download." }, { status: 403 });
  }

  const versionLabelValue =
    computeRoundAttempts(document.versions, reviewRequests, document.revokedAt).byVersionId.get(version.id)?.label ??
    `v${version.versionNumber}`;

  if (format === "pdf") {
    if (!version.previewPdfPath) {
      return NextResponse.json({ error: "No PDF version is available for this file." }, { status: 400 });
    }
    const pdfFilename = buildDownloadFilename(document.title, versionLabelValue, "pdf");
    const url = await getDownloadUrl(version.previewPdfPath, pdfFilename);

    await prisma.documentEvent.create({
      data: { documentId: document.id, userId: user.id, type: "download" },
    });
    await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

    return NextResponse.redirect(url);
  }

  const needsWatermark = user.role === "user" && WATERMARKED_DOC_TYPES.has(document.docType);

  if (needsWatermark) {
    let watermarked: Buffer;
    try {
      const original = await getFileBuffer(version.filePath);
      watermarked = addWatermark(original, version.originalFilename, document.docType);
    } catch (err) {
      console.error(`Watermarking failed for document ${document.id} version ${version.id}:`, err);
      return NextResponse.json(
        { error: "Could not prepare a watermarked copy of this file, ask a contributor or manager to download it." },
        { status: 500 }
      );
    }

    await prisma.documentEvent.create({
      data: { documentId: document.id, userId: user.id, type: "download" },
    });
    await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

    const ext = version.originalFilename.toLowerCase().split(".").pop() ?? "";
    const contentType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    const filename = encodeURIComponent(buildDownloadFilename(document.title, versionLabelValue, ext));
    return new NextResponse(new Uint8Array(watermarked), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  }

  const originalExt = version.originalFilename.split(".").pop() ?? "";
  const url = await getDownloadUrl(version.filePath, buildDownloadFilename(document.title, versionLabelValue, originalExt));

  await prisma.documentEvent.create({
    data: { documentId: document.id, userId: user.id, type: "download" },
  });
  await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

  return NextResponse.redirect(url);
}
