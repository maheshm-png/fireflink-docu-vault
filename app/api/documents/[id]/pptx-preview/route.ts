import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getFileBuffer } from "@/lib/storage";
import { extractPptxSlides } from "@/lib/pptxSlides";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

// GET /api/documents/:id/pptx-preview?version=3 — same access rules as
// /preview (see that route), but returns a parsed slide structure (text +
// images, positioned) as JSON instead of redirecting to the raw file, so
// the browser can render an actual visual approximation of the deck.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const versionParam = req.nextUrl.searchParams.get("version");

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

  if (user.role === "user" && !approvedVersionIds.has(version.id) && document.currentVersionId !== version.id) {
    return NextResponse.json({ error: "Only published versions are available to preview." }, { status: 403 });
  }

  try {
    const buffer = await getFileBuffer(version.filePath);
    const deck = extractPptxSlides(buffer);
    return NextResponse.json(deck);
  } catch (err) {
    console.error("PPTX slide preview failed:", err);
    return NextResponse.json({ error: "Could not render this presentation" }, { status: 500 });
  }
}
