import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { indexDocument, removeFromIndex } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import { validateMetadataAgainstSchema, type CategoryFormField } from "@/lib/formSchema";
import { DUPLICATE_REASON } from "@/lib/duplicates";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      category: true,
      owner: true,
      uploadedBy: true,
      currentVersion: true,
      versions: { orderBy: { versionNumber: "desc" }, include: { uploadedBy: true } },
      stalenessFlags: { where: { resolved: false } },
    },
  });

  // Uploader/owner/manager/superadmin can see pending docs too; everyone
  // else only ever reaches published ones (also enforced by DB-level RLS).
  const canSeeUnpublished =
    document.status === "published" ||
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    user.role === "manager" ||
    user.role === "superadmin";
  if (!canSeeUnpublished) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.documentEvent.create({
    data: { documentId: document.id, userId: user.id, type: "view" },
  });

  // fileSize is a Prisma BigInt on currentVersion/versions — NextResponse.json()
  // can't JSON-stringify it directly, so convert it to a string first.
  return NextResponse.json({
    document: {
      ...document,
      currentVersion: document.currentVersion
        ? { ...document.currentVersion, fileSize: document.currentVersion.fileSize.toString() }
        : null,
      versions: document.versions.map((v) => ({ ...v, fileSize: v.fileSize.toString() })),
    },
  });
}

// PATCH /api/documents/:id — edit title/docType/tags/custom-field metadata.
// Deliberately does NOT touch the file/version — replacing the actual
// document goes through POST /api/documents/:id/versions (and review) instead.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { category: true },
  });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted" }, { status: 400 });
  }

  const canEdit =
    can(user.role, "editOwnUpload") &&
    (document.uploadedById === user.id ||
      document.ownerId === user.id ||
      user.role === "manager" ||
      user.role === "superadmin");
  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { title, docType, tags, metadata } = await req.json();

  const schema = (document.category.formSchema as unknown as CategoryFormField[]) ?? [];
  const { valid, missing } = validateMetadataAgainstSchema(schema, metadata ?? {});
  if (!valid) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Re-evaluate the title-duplicate flag when the title actually changes.
  // File-content duplicates (checksum-based) are untouched here — editing
  // metadata can't change what's actually in the file, so that flag (if
  // any) stands regardless of the new title. A title-based flag, though,
  // may now be resolved (renamed away from the collision) or newly created
  // (renamed into one) — recomputed fresh either way, not trusted from the
  // client, same as the upload route.
  let duplicateUpdate: Partial<{ duplicateOfId: string | null; duplicateReason: string | null }> = {};
  if (title && title.trim() !== document.title) {
    const wasTitleDuplicate = document.duplicateReason === DUPLICATE_REASON.title;
    const wasContentDuplicate = document.duplicateReason === DUPLICATE_REASON.content;
    if (!wasContentDuplicate) {
      const titleMatch = await prisma.document.findFirst({
        where: { title: { equals: title, mode: "insensitive" }, id: { not: document.id }, deletedAt: null },
      });
      if (titleMatch) {
        duplicateUpdate = { duplicateOfId: titleMatch.id, duplicateReason: DUPLICATE_REASON.title };
      } else if (wasTitleDuplicate) {
        duplicateUpdate = { duplicateOfId: null, duplicateReason: null };
      }
    }
  }

  const updated = await prisma.document.update({
    where: { id: document.id },
    data: {
      title,
      docType,
      tags,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      ...duplicateUpdate,
    },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });

  // The public dashboard reads from Meilisearch, not Prisma directly — a
  // title/type/tag edit on an already-published doc needs to propagate
  // there too, or the listing silently goes stale until the next approval.
  if (updated.status === "published") {
    await indexDocument({
      id: updated.id,
      title: updated.title,
      tags: updated.tags,
      categoryName: updated.category.name,
      docType: updated.docType,
      status: updated.status,
      extractedText: updated.currentVersion?.extractedText ?? "",
      uploadedByName: updated.uploadedBy.name,
      isStale: false,
      updatedAt: updated.updatedAt.toISOString(),
      duplicateOfTitle: updated.duplicateOf?.title ?? null,
      hasPreviewPdf: Boolean(updated.currentVersion?.previewPdfPath),
    });
  }

  await logAudit({ userId: user.id, action: "edit", documentId: document.id, documentTitle: updated.title });

  return NextResponse.json({ ok: true });
}

// DELETE /api/documents/:id — soft-delete: hides the document everywhere
// (removed from the search index if it was published) and marks it deleted,
// but keeps its files and DB rows intact for a 30-day recovery window (see
// POST .../restore). Only scripts/run-retention-cleanup.ts permanently
// purges it, once that window has passed. Manager-only, with one narrow
// exception: the uploader can delete their own submission while it's still
// pending_review (withdrawing a mistaken upload) — but never after it's
// been published, which only a manager can take down (and even then via
// revoke, not delete — see app/api/documents/[id]/revoke/route.ts).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has already been deleted" }, { status: 400 });
  }

  const canDelete =
    can(user.role, "deleteDocument") ||
    (document.status === "pending_review" && document.uploadedById === user.id);
  if (!canDelete) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (document.status === "published") {
    await removeFromIndex(document.id);
  }

  await prisma.document.update({
    where: { id: document.id },
    data: { deletedAt: new Date(), deletedById: user.id },
  });

  await logAudit({ userId: user.id, action: "delete", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
