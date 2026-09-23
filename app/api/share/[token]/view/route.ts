import { NextRequest, NextResponse } from "next/server";
import { getPreviewUrl, getFileBuffer } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

// GET /api/share/:token/view?format=pdf|original — public, no auth. Used by
// app/share/[token]/page.tsx's inline <iframe>/<video>. Deliberately
// separate from app/api/documents/[id]/download/route.ts's inline branch
// rather than reusing it — that route requires a logged-in user, this one
// must not.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const format = req.nextUrl.searchParams.get("format");

  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    include: { document: { include: { currentVersion: true } } },
  });
  if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now()) || share.document.deletedAt) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }

  const version = share.document.currentVersion;
  if (!version) return NextResponse.json({ error: "No file available." }, { status: 404 });

  const key = format === "pdf" ? version.previewPdfPath : version.filePath;
  if (!key) return NextResponse.json({ error: "Preview not available for this file." }, { status: 404 });

  // Whatever's being served is a PDF either because it went through the
  // converted-preview path (format=pdf) or because the original upload
  // already was one (format=original with docType "pdf" — a native PDF is
  // never itself run through lib/officeConvert.ts, see app/api/documents/
  // route.ts's isConvertible check, so it has no separate previewPdfPath
  // and format=original IS the PDF).
  const isPdf = format === "pdf" || share.document.docType === "pdf";

  // PDF is proxied through this server rather than redirected to a
  // presigned storage URL — a presigned link, once issued, keeps working
  // on its own for its full TTL (lib/storage.ts's PRESIGNED_URL_TTL_SECONDS)
  // even after the share is revoked or expires, and can be lifted straight
  // out of the Network tab and opened directly, bypassing "view only"
  // entirely. Proxying means every request re-runs the share/expiry check
  // above and never exposes where the file actually lives. Video stays a
  // redirect: buffering a whole video into memory here would also break
  // range-request seeking, for a file type this route was never watermarking
  // or otherwise trying to protect the bytes of in the first place.
  if (isPdf) {
    const buffer = await getFileBuffer(key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  }

  const url = await getPreviewUrl(key);
  return NextResponse.redirect(url);
}
