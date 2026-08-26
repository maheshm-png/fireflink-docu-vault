import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { indexDocument } from "@/lib/search";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const RECOVERY_WINDOW_DAYS = 30;

// POST /api/documents/:id/restore — brings a soft-deleted document back,
// as long as it's still within the 30-day recovery window (past that,
// scripts/run-retention-cleanup.ts has already purged it for good).
// Manager or superadmin — see the rbac.ts comment on viewDeleted/restoreDocument
// for why superadmin is included here even though it can't delete.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "restoreDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });

  if (!document.deletedAt) {
    return NextResponse.json({ error: "This document isn't deleted" }, { status: 400 });
  }

  const ageDays = (Date.now() - document.deletedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > RECOVERY_WINDOW_DAYS) {
    return NextResponse.json({ error: "Past the 30-day recovery window — this document has been permanently removed" }, { status: 400 });
  }

  const restored = await prisma.document.update({
    where: { id: document.id },
    data: { deletedAt: null, deletedById: null },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });

  // Restored to whatever status it had when deleted — if that was
  // "published", it needs to go back into the search index (delete removed
  // it from there).
  if (restored.status === "published") {
    await indexDocument({
      id: restored.id,
      title: restored.title,
      tags: restored.tags,
      categoryName: restored.category.name,
      docType: restored.docType,
      status: restored.status,
      extractedText: restored.currentVersion?.extractedText ?? "",
      uploadedByName: restored.uploadedBy.name,
      isStale: false,
      updatedAt: restored.updatedAt.toISOString(),
      duplicateOfTitle: restored.duplicateOf?.title ?? null,
      hasPreviewPdf: Boolean(restored.currentVersion?.previewPdfPath),
    });
  }

  await logAudit({ userId: user.id, action: "restore", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
