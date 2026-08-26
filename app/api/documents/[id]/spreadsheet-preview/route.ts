import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getFileBuffer } from "@/lib/storage";
import { extractXlsxPreview, parseCsvPreview } from "@/lib/spreadsheet";
import { prisma } from "@/lib/prisma";

// GET /api/documents/:id/spreadsheet-preview?version=3 — same access rules
// as /preview, but returns parsed rows/cells as JSON for .xlsx/.xls/.csv
// files so the browser can render an actual table instead of a download
// prompt.
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

  const canAccessUnpublished =
    document.status === "published" ||
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
