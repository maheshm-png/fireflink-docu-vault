import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getPreviewUrl, getFileBuffer } from "@/lib/storage";
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

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { currentVersion: true, versions: true },
  });

  if (document.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Revoked is deliberately open to everyone here (unlike /download's copy of
  // this same check) — a revoked doc should still be viewable org-wide with
  // its revoke reason visible (see app/dashboard/revoked/page.tsx), just not
  // downloadable by anyone who isn't already covered below.
  const canAccessUnpublished =
    document.status === "published" ||
    document.status === "revoked" ||
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    user.role === "manager" ||
    user.role === "superadmin";

  if (!canAccessUnpublished) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const version = versionParam
    ? document.versions.find((v) => v.versionNumber === parseInt(versionParam, 10))
    : document.currentVersion;

  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  // Prefer the LibreOffice-converted PDF (see lib/officeConvert.ts) when one
  // exists — accurate rendering through the existing PDF viewer instead of
  // the file's native (often unrenderable-inline) format.
  const key = version.previewPdfPath || version.filePath;

  await prisma.documentEvent.create({
    data: { documentId: document.id, userId: user.id, type: "view" },
  });

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
