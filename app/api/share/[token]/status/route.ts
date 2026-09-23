import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/share/:token/status — public, no auth. Polled by
// components/ShareLinkWatcher.tsx (rendered on the open share page itself)
// so a tab left open on a share keeps reflecting whatever the owner does
// with it afterward — access level tightened/loosened, expiry changed, or
// sharing stopped entirely — instead of silently going stale until the
// viewer happens to refresh on their own. Deliberately its own tiny route
// rather than reusing /view or the page itself: this only ever needs to
// return the few fields that can change out from under an open tab, not
// the file or the page's full markup.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    select: { accessLevel: true, expiresAt: true, document: { select: { deletedAt: true } } },
  });

  const available =
    Boolean(share) &&
    !share!.document.deletedAt &&
    (share!.expiresAt === null || share!.expiresAt.getTime() > Date.now());

  if (!available) {
    return NextResponse.json({ available: false });
  }

  return NextResponse.json({
    available: true,
    accessLevel: share!.accessLevel,
    expiresAt: share!.expiresAt,
  });
}
