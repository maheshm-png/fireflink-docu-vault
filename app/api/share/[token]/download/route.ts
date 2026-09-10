import { NextRequest, NextResponse } from "next/server";
import { getDownloadUrl } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

// GET /api/share/:token/download — public, no auth. Serves the clean
// original file (no watermark — shared-link downloads were deliberately
// scoped the same as a Contributor/Manager's download, not the "user"
// role's watermarked one).
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    include: { document: { include: { currentVersion: true } } },
  });
  if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now()) || share.document.deletedAt) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }
  if (share.accessLevel !== "view_download") {
    return NextResponse.json({ error: "This link only allows viewing, not downloading." }, { status: 403 });
  }

  const version = share.document.currentVersion;
  if (!version) return NextResponse.json({ error: "No file available." }, { status: 404 });

  const url = await getDownloadUrl(version.filePath, version.originalFilename);
  return NextResponse.redirect(url);
}
