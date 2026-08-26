import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getPreviewUrl } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

// GET /api/documents/:id/preview?version=3 — same access rules as
// /download (see that route), but resolves an inline-disposition presigned
// URL instead of a forced-download one, so an <iframe>/<video> can render
// the file in place rather than triggering a save dialog.
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
  const url = await getPreviewUrl(version.previewPdfPath || version.filePath);

  await prisma.documentEvent.create({
    data: { documentId: document.id, userId: user.id, type: "view" },
  });

  return NextResponse.redirect(url);
}
