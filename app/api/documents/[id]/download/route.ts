import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { getDownloadUrl, getFileBuffer } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { addWatermark } from "@/lib/watermark";
import { prisma } from "@/lib/prisma";

const WATERMARKED_DOC_TYPES = new Set(["doc", "ppt", "excel"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// GET /api/documents/:id/download?version=3 (omit for current/published version)
//
// Every active user (Manager, SC, BD, and view-only Other alike) can reach
// this route and download a *published* document — download is part of
// "view access," same as seeing it in the dashboard. Only the uploader,
// the doc's owner, or a Manager/Superadmin can download a version that's
// still pending review or was rejected.
//
// The file is served byte-for-byte from storage via a redirect to a
// presigned URL — nothing here re-encodes, re-compresses, or otherwise
// touches the file, so PPT layout, video quality, and PDF formatting are
// preserved exactly as uploaded.
//
// The base view-only "user" role downloading a Word/PPT/Excel file in its
// original format gets a Fireflink-logo-watermarked copy (lib/watermark.ts)
// instead of the clean file — contributors, managers, and superadmin are
// unaffected. That can't be a redirect to a presigned URL since the bytes
// are generated on the fly, so this branch streams the watermarked buffer
// directly instead.
//
// ?format=pdf|original (either role's default is "original" when omitted)
// — every role can choose to download the LibreOffice-converted PDF instead
// of the original, when one exists (hasPreviewPdf). The PDF is never
// watermarked (it isn't the editable original the "user"-role restriction
// cares about) and isn't restricted to any particular role.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const versionParam = req.nextUrl.searchParams.get("version");
  const format = req.nextUrl.searchParams.get("format");

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { currentVersion: true, versions: true },
  });

  // Soft-deleted docs are off-limits until restored, even for managers —
  // restore first if you need to look at the content again.
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

  if (format === "pdf") {
    if (!version.previewPdfPath) {
      return NextResponse.json({ error: "No PDF version is available for this file." }, { status: 400 });
    }
    const pdfFilename = version.originalFilename.replace(/\.[^./]+$/, ".pdf");
    const url = await getDownloadUrl(version.previewPdfPath, pdfFilename);

    await prisma.documentEvent.create({
      data: { documentId: document.id, userId: user.id, type: "download" },
    });
    await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

    return NextResponse.redirect(url);
  }

  const needsWatermark = user.role === "user" && WATERMARKED_DOC_TYPES.has(document.docType);

  if (needsWatermark) {
    let watermarked: Buffer;
    try {
      const original = await getFileBuffer(version.filePath);
      watermarked = addWatermark(original, version.originalFilename, document.docType);
    } catch (err) {
      console.error(`Watermarking failed for document ${document.id} version ${version.id}:`, err);
      return NextResponse.json(
        { error: "Could not prepare a watermarked copy of this file — ask a contributor or manager to download it." },
        { status: 500 }
      );
    }

    await prisma.documentEvent.create({
      data: { documentId: document.id, userId: user.id, type: "download" },
    });
    await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

    const ext = version.originalFilename.toLowerCase().split(".").pop() ?? "";
    const contentType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    const filename = encodeURIComponent(version.originalFilename);
    return new NextResponse(new Uint8Array(watermarked), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  }

  const url = await getDownloadUrl(version.filePath, version.originalFilename);

  await prisma.documentEvent.create({
    data: { documentId: document.id, userId: user.id, type: "download" },
  });
  await logAudit({ userId: user.id, action: "download", documentId: document.id, documentTitle: document.title });

  return NextResponse.redirect(url);
}
