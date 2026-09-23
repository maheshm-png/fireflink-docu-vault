import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getFileBuffer } from "@/lib/storage";
import { extractXlsxPreview, parseCsvPreview } from "@/lib/spreadsheet";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

// GET /api/documents/:id/spreadsheet-preview?version=3 — same access rules
// as /preview, but returns parsed rows/cells as JSON for .xlsx/.xls/.csv
// files so the browser can render an actual table instead of a download
// prompt.
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
    const isCsv = version.originalFilename.toLowerCase().endsWith(".csv");
    const preview = isCsv ? parseCsvPreview(buffer.toString("utf-8")) : extractXlsxPreview(buffer);
    return NextResponse.json(preview);
  } catch (err) {
    console.error("Spreadsheet preview failed:", err);
    return NextResponse.json({ error: "Could not render this spreadsheet" }, { status: 500 });
  }
}
