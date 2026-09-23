import { NextRequest, NextResponse } from "next/server";
import { getDownloadUrl } from "@/lib/storage";
import { computeRoundAttempts } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

// Same filename convention as app/api/documents/[id]/download/route.ts's
// own buildDownloadFilename — kept as its own small copy rather than a
// shared import since that file also has a title-sanitizing helper this
// route needs too and pulling in the whole route module for two functions
// isn't worth it.
function safeFilenameFromTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "document";
}
function buildDownloadFilename(title: string, label: string, ext: string): string {
  return `${safeFilenameFromTitle(title)} (${label}).${ext}`;
}

// GET /api/share/:token/download — public, no auth. Serves the clean
// original file (no watermark — shared-link downloads were deliberately
// scoped the same as a Contributor/Manager's download, not the "user"
// role's watermarked one).
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    include: {
      document: {
        include: { currentVersion: true, versions: { select: { id: true, versionNumber: true, uploadedAt: true } } },
      },
    },
  });
  if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now()) || share.document.deletedAt) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }
  if (share.accessLevel !== "view_download") {
    return NextResponse.json({ error: "This link only allows viewing, not downloading." }, { status: 403 });
  }

  const version = share.document.currentVersion;
  if (!version) return NextResponse.json({ error: "No file available." }, { status: 404 });

  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId: share.document.id },
    select: { roundNumber: true, status: true, comments: true, createdAt: true },
  });
  const label =
    computeRoundAttempts(share.document.versions, reviewRequests, share.document.revokedAt).byVersionId.get(version.id)
      ?.label ?? `v${version.versionNumber}`;
  const ext = version.originalFilename.split(".").pop() ?? "";

  const url = await getDownloadUrl(version.filePath, buildDownloadFilename(share.document.title, label, ext));
  return NextResponse.redirect(url);
}
