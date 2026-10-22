import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { indexDocument, removeFromIndex } from "@/lib/search";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";
import { accessInclude, documentAccessWhere, documentRole, documentRoleById, passesTeamGate, teamAllows } from "@/lib/access";
import { isWithdrawalBeforeReview, purgeDocument } from "@/lib/purgeDocument";
import { validateMetadataAgainstSchema, type CategoryFormField } from "@/lib/formSchema";
import { DUPLICATE_REASON } from "@/lib/duplicates";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    include: {
      category: true,
      owner: true,
      uploadedBy: true,
      currentVersion: true,
      versions: { orderBy: { versionNumber: "desc" }, include: { uploadedBy: true } },
      stalenessFlags: { where: { resolved: false } },
      ...accessInclude,
    },
  });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same "is there a real, currently-live approved version" check the
  // dashboard page uses (app/dashboard/documents/[id]/page.tsx's
  // hasEverPublished/isPubliclyVisible): a document simply back in
  // re-review after already being published once (status pending_review or
  // rejected) must stay visible to everyone, same as it does there.
  // Checking the raw document.status === "published" here would 404 a
  // document the dashboard just showed as accessible.
  const reviewRequestsForVisibility = await prisma.reviewRequest.findMany({
    where: { documentId: document.id },
    select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewerId: true },
  });
  const hasEverPublished =
    document.currentVersionId !== null &&
    everApprovedVersionIds(document.versions, reviewRequestsForVisibility, document.revokedAt).has(
      document.currentVersionId
    );
  const isPubliclyVisible = hasEverPublished && document.status !== "revoked" && document.status !== "archived";
  // Archived after being published: anyone who could see it may still open
  // and preview it, but nobody can download it (see /download).
  const archivedViewable = hasEverPublished && document.status === "archived";

  // Uploader/owner/an assigned reviewer (any round)/superadmin can see a
  // not-yet-public document too; a manager with no assignment on THIS
  // document can't, same as app/dashboard/documents/[id]/page.tsx's own
  // canSeeUnpublishedDoc (its own comment has the full reasoning). Everyone
  // else only ever reaches publicly visible ones (also enforced by DB-level RLS).
  const canSeeUnpublished =
    ((isPubliclyVisible || archivedViewable) && teamAllows(user, document)) ||
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    reviewRequestsForVisibility.some((r) => r.reviewerId === user.id) ||
    user.role === "superadmin";
  if (!canSeeUnpublished) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Same rule as the document page: a deleted document is only visible to
  // roles that manage Deleted Documents.
  if (document.deletedAt && !can(user.role, "viewDeleted")) {
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

// PATCH /api/documents/:id — edit title/tags/custom-field metadata.
// Deliberately does NOT touch the file/version — replacing the actual
// document goes through POST /api/documents/:id/versions (and review)
// instead. docType is likewise not editable here: it's set once at initial
// upload (app/api/documents/route.ts, validated against the actual bytes)
// and every later version upload is checked against that same fixed type
// (app/api/documents/[id]/versions/route.ts) rather than allowed to change
// it — a document silently relabeled to a type its actual file isn't would
// break every downstream feature that trusts docType (preview renderer,
// watermarking rules in app/api/documents/[id]/download/route.ts,
// LibreOffice conversion assumptions), so there's no door to change it
// after the fact.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    include: {
      category: true,
      teamAccess: { select: { teamId: true } },
      reviewRequests: { select: { reviewerId: true } },
      globalRequests: { select: { status: true, decidedById: true } },
    },
  });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted" }, { status: 400 });
  }

  // Team documents use the caller's team role (lib/access.ts documentRole).
  const role = documentRole(user, document);
  const canEdit =
    can(role, "editOwnUpload") &&
    (document.uploadedById === user.id ||
      document.ownerId === user.id ||
      role === "manager" ||
      role === "superadmin");
  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { metadata, categoryId, extraCategoryIds } = body;
  const title = typeof body.title === "string" ? body.title.trim() : body.title;
  const tags = Array.isArray(body.tags) ? body.tags.map((t: unknown) => (typeof t === "string" ? t.trim() : t)).filter(Boolean) : body.tags;
  if (title !== undefined && (typeof title !== "string" || !title)) {
    return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t: unknown) => typeof t !== "string"))) {
    return NextResponse.json({ error: "Tags must be a list of words." }, { status: 400 });
  }
  if (metadata !== undefined && metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    return NextResponse.json({ error: "Malformed metadata." }, { status: 400 });
  }

  // Moving to another main category, and "Also show in" extra categories.
  // Both optional; no new review, since the file doesn't change. The main
  // category's fields are what the metadata is checked against.
  let mainCategory = document.category;
  // Team documents don't use global categories (lib/teamCategory.ts).
  if (document.visibility === "restricted" && ((categoryId !== undefined && categoryId !== document.categoryId) || (Array.isArray(extraCategoryIds) && extraCategoryIds.length))) {
    return NextResponse.json({ error: "Team documents don't have a category. Use the team's folders instead." }, { status: 400 });
  }
  if (categoryId !== undefined && categoryId !== document.categoryId) {
    const found = typeof categoryId === "string" ? await prisma.category.findUnique({ where: { id: categoryId } }) : null;
    if (!found || found.isSystem) return NextResponse.json({ error: "That category doesn't exist." }, { status: 400 });
    mainCategory = found;
  }
  let extras: string[] | null = null;
  if (extraCategoryIds !== undefined) {
    if (!Array.isArray(extraCategoryIds) || extraCategoryIds.some((c) => typeof c !== "string")) {
      return NextResponse.json({ error: "extraCategoryIds must be a list of category ids." }, { status: 400 });
    }
    extras = [...new Set(extraCategoryIds as string[])].filter((c) => c !== mainCategory.id);
    if (extras.length && (await prisma.category.count({ where: { id: { in: extras } } })) !== extras.length) {
      return NextResponse.json({ error: "One of the extra categories doesn't exist." }, { status: 400 });
    }
  }

  const schema = (mainCategory.formSchema as unknown as CategoryFormField[]) ?? [];
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
        // Only documents this editor can see, so another team's restricted
        // document is never named as the match.
        where: {
          AND: [{ title: { equals: title, mode: "insensitive" }, id: { not: document.id }, deletedAt: null }, documentAccessWhere(user)],
        },
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
      tags,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      ...(mainCategory.id !== document.categoryId ? { categoryId: mainCategory.id } : {}),
      ...(extras !== null
        ? {
            extraCategories: {
              deleteMany: {},
              ...(extras.length ? { create: extras.map((c) => ({ categoryId: c })) } : {}),
            },
          }
        : {}),
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
//
// Once some manager has actually approved this document, a DIFFERENT
// manager who was never part of that decision (never assigned as a
// reviewer on any round, and isn't the uploader/owner) can no longer delete
// it out from under that approval — see app/dashboard/documents/[id]/
// page.tsx's matching canDelete for the same rule, enforced here since the
// UI hiding the button isn't enough on its own against a direct API call.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has already been deleted" }, { status: 400 });
  }

  let canDeleteAsManager = can(await documentRoleById(user, document.id), "deleteDocument");
  if (canDeleteAsManager) {
    const reviewRequests = await prisma.reviewRequest.findMany({
      where: { documentId: document.id },
      select: { status: true, reviewerId: true },
    });
    const everApproved = reviewRequests.some((r) => r.status === "approved");
    const inReviewCycle =
      document.uploadedById === user.id ||
      document.ownerId === user.id ||
      reviewRequests.some((r) => r.reviewerId === user.id);
    canDeleteAsManager = !everApproved || inReviewCycle;
  }

  const canDelete =
    canDeleteAsManager || (document.status === "pending_review" && document.uploadedById === user.id);
  if (!canDelete) {
    return NextResponse.json(
      { error: "Only a manager who was part of this document's review can delete it once it's been approved." },
      { status: 403 }
    );
  }

  // The uploader withdrawing their own submission before any reviewer has
  // decided on it is purged outright, not soft-deleted: nothing about it
  // was ever approved, so there's nothing to recover, and keeping it would
  // leave it on the reviewer's side (their open review page, their
  // notification) after the uploader pulled it. Anything that has been
  // through a decision (approved, rejected, or revoked back into review)
  // still takes the recoverable soft delete below.
  if (await isWithdrawalBeforeReview(document, user.id)) {
    await purgeDocument(document.id);
    await logAudit({ userId: user.id, action: "purge", documentId: document.id, documentTitle: document.title });
    return NextResponse.json({ ok: true, purged: true });
  }

  // Unconditional: a document back in re-review (status pending_review or
  // rejected) still has its prior approved version in the index, so gating
  // this on status "published" left deleted documents listed. Removing an
  // id that was never indexed is a harmless no-op.
  await removeFromIndex(document.id);

  await prisma.document.update({
    where: { id: document.id },
    data: { deletedAt: new Date(), deletedById: user.id },
  });

  await logAudit({ userId: user.id, action: "delete", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
