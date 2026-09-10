import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage";
import { extractPptxSlides } from "@/lib/pptxSlides";
import { prisma } from "@/lib/prisma";

// GET /api/share/:token/pptx-preview — public counterpart to
// app/api/documents/[id]/pptx-preview/route.ts (same parsed-slide-JSON
// approach, extractPptxSlides is unchanged/shared), just gated by the
// share token instead of a logged-in user.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await prisma.shareLink.findUnique({
    where: { token: params.token },
    include: { document: { include: { currentVersion: true } } },
  });
  if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now()) || share.document.deletedAt) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }

  const version = share.document.currentVersion;
  if (!version) return NextResponse.json({ error: "No file available." }, { status: 404 });

  try {
    const buffer = await getFileBuffer(version.filePath);
    const deck = extractPptxSlides(buffer);
    return NextResponse.json(deck);
  } catch (err) {
    console.error("PPTX slide preview failed:", err);
    return NextResponse.json({ error: "Could not render this presentation" }, { status: 500 });
  }
}
