import { NextRequest, NextResponse } from "next/server";
import { getPreviewUrl } from "@/lib/storage";
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

  const url = await getPreviewUrl(key);
  return NextResponse.redirect(url);
}
