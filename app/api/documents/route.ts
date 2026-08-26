import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { buildStorageKey, uploadFile } from "@/lib/storage";
import { extractText } from "@/lib/extract";
import { convertToPdf, isConvertible } from "@/lib/officeConvert";
import { logAudit } from "@/lib/audit";
import { notifyManagerReviewNeeded } from "@/lib/notify";
import { validateMetadataAgainstSchema, type CategoryFormField } from "@/lib/formSchema";
import { validateFileMatchesDocType } from "@/lib/fileTypeValidation";
import { DUPLICATE_REASON } from "@/lib/duplicates";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// GET /api/documents — list (mainly used for admin/manager views;
// the public dashboard reads from Meilisearch instead for speed).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same visibility rule as GET /api/documents/:id: everyone sees published
  // docs, uploader/owner/manager/superadmin also see their own non-published
  // ones. Soft-deleted docs are excluded outright (see viewDeleted/restore
  // for the manager-only recovery path). User relations are select-limited
  // so this never leaks passwordHash or other internal fields.
  const canSeeAll = user.role === "manager" || user.role === "superadmin";
  const userSelect = { id: true, name: true, email: true, role: true } as const;

  const docs = await prisma.document.findMany({
    where: {
      deletedAt: null,
      ...(canSeeAll
        ? {}
        : { OR: [{ status: "published" as const }, { uploadedById: user.id }, { ownerId: user.id }] }),
    },
    include: {
      category: true,
      currentVersion: true,
      owner: { select: userSelect },
      uploadedBy: { select: userSelect },
    },
    orderBy: { updatedAt: "desc" },
  });
  // currentVersion.fileSize is a Prisma BigInt — NextResponse.json() can't
  // JSON-stringify it directly, so convert it to a string first.
  return NextResponse.json(
    docs.map((d) => ({
      ...d,
      currentVersion: d.currentVersion
        ? { ...d.currentVersion, fileSize: d.currentVersion.fileSize.toString() }
        : null,
    }))
  );
}

// POST /api/documents — upload a new document (lands as pending_review).
// Expects multipart/form-data: file, title, categoryId, ownerId, tags
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "upload");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  // External-link uploads have been removed — every document is a real
  // file now. This blocks it at the API too, not just by removing the
  // "Link External URL" option from the upload form, since this route can
  // be called directly.
  if (form.get("externalUrl")) {
    return NextResponse.json({ error: "Linked (non-file) uploads are no longer supported." }, { status: 400 });
  }
  const title = form.get("title") as string;
  const categoryId = form.get("categoryId") as string;
  const ownerId = form.get("ownerId") as string; // who will review/approve
  const tags = (form.get("tags") as string)?.split(",").map((t) => t.trim()) ?? [];
  const docTypeRaw = (form.get("docType") as string) ?? "other";
  const metadataRaw = form.get("metadata") as string | null;
  const confirmDuplicate = form.get("confirmDuplicate") === "true";
  const confirmedDuplicateOfId = form.get("duplicateOfId") as string | null;

  if (!file || !title || !categoryId || !ownerId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // A manager uploading their own document can't also be its reviewer — the
  // whole point of review is a second set of eyes. The upload form's
  // reviewer dropdown (/api/reviewers) already excludes the caller, but this
  // route can be called directly, so it's the real gate.
  if (ownerId === user.id) {
    return NextResponse.json(
      { error: "You can't assign yourself as the reviewer for your own upload — choose someone else." },
      { status: 400 }
    );
  }

  const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

  let metadata: Record<string, unknown> = {};
  try {
    metadata = metadataRaw ? JSON.parse(metadataRaw) : {};
  } catch {
    return NextResponse.json({ error: "Malformed metadata" }, { status: 400 });
  }

  // Server-side enforcement of the category's required fields — the
  // upload form enforces this client-side too, but this route can be
  // called directly, so the check has to live here as the real gate.
  const schema = (category.formSchema as unknown as CategoryFormField[]) ?? [];
  const { valid, missing } = validateMetadataAgainstSchema(schema, metadata);
  if (!valid) {
    return NextResponse.json(
      { error: `Missing required field(s) for "${category.name}": ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const typeError = validateFileMatchesDocType(buffer, file.name, docTypeRaw);
  if (typeError) {
    return NextResponse.json({ error: typeError }, { status: 400 });
  }

  // Duplicate check — before any storage write, so a rejected duplicate
  // never costs a wasted upload. Two independent signals: identical file
  // content (checksum, across any existing version) or an identical title.
  // Either can be force-uploaded past (confirmDuplicate),
  // but the resulting document is tagged with duplicateOfId/duplicateReason
  // so it's visible to everyone, not silently forked content. Re-derived
  // server-side (not trusted from the client) even on a confirmed
  // force-upload, so the stored reason always reflects what was matched.
  const [checksumMatch, titleMatch] = await Promise.all([
    checksum
      ? prisma.documentVersion.findFirst({ where: { checksum, document: { deletedAt: null } }, include: { document: true } })
      : Promise.resolve(null),
    prisma.document.findFirst({ where: { title: { equals: title, mode: "insensitive" }, deletedAt: null } }),
  ]);
  const duplicateMatch = checksumMatch?.document ?? titleMatch;
  const duplicateReason = checksumMatch ? DUPLICATE_REASON.content : DUPLICATE_REASON.title;

  if (duplicateMatch && !(confirmDuplicate && confirmedDuplicateOfId === duplicateMatch.id)) {
    return NextResponse.json(
      { duplicate: { documentId: duplicateMatch.id, title: duplicateMatch.title, reason: duplicateReason } },
      { status: 409 }
    );
  }

  const documentId = crypto.randomUUID();
  const storageKey = buildStorageKey(category.name.toLowerCase().replace(/\s+/g, "-"), documentId, file.name);

  // extractText, uploadFile, and the LibreOffice PDF conversion all just
  // read the already-buffered file and don't depend on each other —
  // running them concurrently instead of one after the other cuts upload
  // latency significantly for larger files. Conversion is best-effort: it
  // returns null (never throws) if LibreOffice isn't installed or the
  // file can't be converted, and the preview falls back gracefully then.
  const [extractedText, , pdfBuffer] = await Promise.all([
    extractText(buffer!, file.name),
    uploadFile(storageKey, buffer!, file.type),
    isConvertible(file.name) ? convertToPdf(buffer!, file.name) : Promise.resolve(null),
  ]);

  let previewPdfPath: string | null = null;
  if (pdfBuffer) {
    previewPdfPath = `${storageKey}.preview.pdf`;
    await uploadFile(previewPdfPath, pdfBuffer, "application/pdf");
  }

  const document = await prisma.document.create({
    data: {
      id: documentId,
      title,
      categoryId,
      docType: docTypeRaw as any,
      status: "pending_review",
      tags,
      metadata: metadata as Prisma.InputJsonValue,
      ownerId,
      uploadedById: user.id,
      neverExpires: category.reviewCycleDays === null,
      ...(duplicateMatch ? { duplicateOfId: duplicateMatch.id, duplicateReason } : {}),
      versions: {
        create: {
          versionNumber: 1,
          filePath: storageKey,
          originalFilename: file.name,
          fileSize: BigInt(buffer!.length),
          checksum: checksum!,
          extractedText,
          previewPdfPath,
          uploadedById: user.id,
        },
      },
    },
    include: { versions: true, category: true, owner: true },
  });

  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: document.versions[0].id },
  });

  await prisma.reviewRequest.create({
    data: {
      documentId: document.id,
      requestedById: user.id,
      reviewerId: ownerId,
    },
  });

  await logAudit({ userId: user.id, action: "upload", documentId: document.id, documentTitle: title });

  // Deliberately no whole-team notification here — a fresh upload awaiting
  // its first review is routine, pre-publish status (see lib/notify.ts).
  // The assigned reviewer does get a targeted action-item alert, though, on
  // the separate manager-only Chat space.
  await notifyManagerReviewNeeded({
    documentTitle: document.title,
    documentId: document.id,
    categoryName: document.category.name,
    uploaderName: user.name,
    reviewerId: document.ownerId,
    reviewerName: document.owner.name,
    isNewVersion: false,
  });

  // NOTE: this does not yet index into Meilisearch — it's intentionally
  // excluded from search until it's approved and published.

  // Only { id } — the caller (UploadForm) just redirects to the new doc's
  // page. Returning the full Prisma object would also fail to serialize:
  // DocumentVersion.fileSize is a BigInt, which NextResponse.json() can't
  // JSON-stringify.
  return NextResponse.json({ document: { id: document.id } }, { status: 201 });
}
