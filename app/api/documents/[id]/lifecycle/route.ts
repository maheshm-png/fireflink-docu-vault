import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { indexDocument } from "@/lib/search";
import { prisma } from "@/lib/prisma";

// PATCH /api/documents/:id/lifecycle — manager-tier document-lifecycle
// actions that don't fit the review/revoke/archive/delete verbs:
//   - "extend": sets reviewDueAt to `days` from now (the manager picks
//     exactly how far out to push the review, rather than silently reusing
//     the category's default cycle) and clears any open staleness flags —
//     for a manager confirming "this is still accurate for N more days"
//     without going through the full approve flow.
//   - "toggle-permanent": flips neverExpires — exempts the document from
//     staleness flagging and from the old-version retention purge entirely.
//   - "dismiss-duplicate": clears a duplicate flag the manager has reviewed
//     and judged to be a false positive (or an acceptable, deliberate
//     near-duplicate) — doesn't re-run detection, just clears it.
//   - "set-current-version": swaps which already-uploaded version is served/
//     searched/downloaded as "the" document, without a new upload or review
//     cycle — e.g. rolling back to the previous version because a fresh one
//     turned out to have an error. Published documents only: a document
//     still mid-review already has an explicit versionId picker on the
//     approve action itself (see .../review/route.ts), and a revoked one has
//     a fresh ReviewRequest open that this would sidestep confusingly.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "manageDocumentLifecycle");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { action, days, versionId } = await req.json();
  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted" }, { status: 400 });
  }

  switch (action) {
    case "extend": {
      if (!Number.isInteger(days) || days < 1) {
        return NextResponse.json({ error: "Enter a whole number of days (at least 1)" }, { status: 400 });
      }
      const reviewDueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.document.update({ where: { id: document.id }, data: { reviewDueAt } }),
        prisma.stalenessFlag.updateMany({ where: { documentId: document.id, resolved: false }, data: { resolved: true } }),
      ]);
      await logAudit({ userId: user.id, action: "extend_validity", documentId: document.id, documentTitle: document.title });
      break;
    }
    case "toggle-permanent": {
      await prisma.document.update({ where: { id: document.id }, data: { neverExpires: !document.neverExpires } });
      await logAudit({ userId: user.id, action: "toggle_permanent", documentId: document.id, documentTitle: document.title });
      break;
    }
    case "dismiss-duplicate": {
      const updated = await prisma.document.update({
        where: { id: document.id },
        data: { duplicateOfId: null, duplicateReason: null },
        include: { category: true, currentVersion: true, uploadedBy: true },
      });
      // The public dashboard reads from Meilisearch, not Prisma directly —
      // clearing the flag here silently went stale there until the next
      // unrelated re-index (the same class of bug already fixed for PATCH
      // title edits in app/api/documents/[id]/route.ts).
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
          duplicateOfTitle: null,
          hasPreviewPdf: Boolean(updated.currentVersion?.previewPdfPath),
        });
      }
      await logAudit({ userId: user.id, action: "dismiss_duplicate", documentId: document.id, documentTitle: document.title });
      break;
    }
    case "set-current-version": {
      if (document.status !== "published") {
        return NextResponse.json(
          { error: "Only a published document's current version can be changed this way" },
          { status: 400 }
        );
      }
      if (typeof versionId !== "string") {
        return NextResponse.json({ error: "versionId is required" }, { status: 400 });
      }
      const targetVersion = await prisma.documentVersion.findFirst({
        where: { id: versionId, documentId: document.id },
      });
      if (!targetVersion) {
        return NextResponse.json({ error: "That version doesn't belong to this document" }, { status: 400 });
      }
      if (targetVersion.id === document.currentVersionId) {
        return NextResponse.json({ error: "That's already the current version" }, { status: 400 });
      }

      const updated = await prisma.document.update({
        where: { id: document.id },
        data: { currentVersionId: targetVersion.id },
        include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
      });

      // Same reasoning as dismiss-duplicate above — the dashboard/search
      // results need to reflect the newly-live version's content and preview
      // right away, not just the next time something else happens to touch it.
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

      await logAudit({
        userId: user.id,
        action: "set_current_version",
        documentId: document.id,
        documentTitle: `${document.title} (now v${targetVersion.versionNumber})`,
      });
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
