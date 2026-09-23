import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getPreviewUrl, getFileBuffer } from "@/lib/storage";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

// GET /api/documents/:id/preview?version=3 — same access rules as
// /download (see that route), but resolves an inline-disposition presigned
// URL instead of a forced-download one, so an <iframe>/<video> can render
// the file in place rather than triggering a save dialog.
//
// ?raw=1 instead streams the file's actual bytes through this same-origin
// response rather than redirecting to a presigned storage URL — needed by
// components/PdfHighlightViewer.tsx, which loads the PDF via pdf.js's own
// fetch() (to get a real, selectable text layer) rather than an <iframe>.
// An <iframe> navigating to a cross-origin redirect target doesn't need
// CORS, but a JS fetch() DOES need the final response to carry CORS
// headers for the redirected-to origin — which our storage (MinIO/S3)
// isn't configured for — so pdf.js fetching the presigned URL directly
// would be silently blocked. Proxying the bytes through our own API sidesteps
// that entirely: the browser only ever talks to this same-origin route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const versionParam = req.nextUrl.searchParams.get("version");

  // Independent of each other (reviewRequests only needs params.id) — this
  // route fires on every document open, so not serializing the two saves a
  // full round-trip on very high-frequency traffic.
  const [document, reviewRequests] = await Promise.all([
    prisma.document.findUniqueOrThrow({
      where: { id: params.id },
      include: { currentVersion: true, versions: true },
    }),
    prisma.reviewRequest.findMany({
      where: { documentId: params.id },
      select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewerId: true },
    }),
  ]);

  if (document.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const approvedVersionIds = everApprovedVersionIds(document.versions, reviewRequests, document.revokedAt);
  // A document simply back in re-review after already being published once
  // (status pending_review or rejected, but it has a real approved version
  // behind it) stays previewable on that still-live version — checking the
  // raw document.status === "published" here used to 404 every preview
  // attempt while a new version was mid-review, even though the page itself
  // still showed the document as open. Revoked is deliberately open to
  // everyone here too (unlike /download's copy of this same check) — a
  // revoked doc should still be viewable org-wide with its revoke reason
  // visible (see app/dashboard/revoked/page.tsx), just not downloadable by
  // anyone who isn't already covered below.
  const hasEverPublished = document.currentVersionId !== null && approvedVersionIds.has(document.currentVersionId);
  const isPubliclyVisible = hasEverPublished && document.status !== "archived";

  // Uploader/owner/an assigned reviewer (any round)/superadmin, same
  // narrower rule as app/dashboard/documents/[id]/page.tsx's
  // canSeeUnpublishedDoc — a manager with no assignment on this document
  // can't preview its still-pending content early either.
  const canAccessUnpublished =
    isPubliclyVisible ||
    document.status === "revoked" ||
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

  // The base view-only "user" role can preview any version that actually
  // passed review at some point (an old published one, or whatever's
  // current), never one that's still pending or was rejected — same rule
  // /download enforces, matching what the Versions tab even shows them.
  if (user.role === "user" && !approvedVersionIds.has(version.id) && document.currentVersionId !== version.id) {
    return NextResponse.json({ error: "Only published versions are available to preview." }, { status: 403 });
  }

  // Prefer the LibreOffice-converted PDF (see lib/officeConvert.ts) when one
  // exists — accurate rendering through the existing PDF viewer instead of
  // the file's native (often unrenderable-inline) format.
  const key = version.previewPdfPath || version.filePath;

  // Logging this view doesn't need to block the actual preview response —
  // fire-and-forget, with the error still surfaced to server logs.
  prisma.documentEvent
    .create({ data: { documentId: document.id, userId: user.id, type: "view" } })
    .catch((err) => console.error("Failed to log document view event", err));

  if (req.nextUrl.searchParams.get("raw") === "1") {
    const buffer = await getFileBuffer(key);
    // NextResponse's BodyInit type doesn't accept Node's Buffer/typed-array
    // views under this TS lib's stricter generic ArrayBufferLike checking,
    // even though it's a perfectly valid body at runtime — same class of
    // mismatch as elsewhere in this app where a Node type doesn't quite
    // line up with the DOM lib's expectations.
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const url = await getPreviewUrl(key);
  return NextResponse.redirect(url);
}
