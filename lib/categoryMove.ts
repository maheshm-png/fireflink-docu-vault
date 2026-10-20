// Moving documents between global categories in bulk (the Categories page's
// "Move documents" and "Delete" actions). A single document's category is
// changed from its own edit form instead (app/api/documents/[id]/route.ts).
import { prisma } from "./prisma";
import { allIndexedCategoryNames, setIndexedCategoryName } from "./search";

/** Resolves where documents are being moved to: an existing global
 * category, or a new one created on the spot from just a name. */
export async function resolveMoveTarget(
  userId: string,
  sourceId: string,
  body: { toCategoryId?: unknown; newCategoryName?: unknown }
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const newName = typeof body.newCategoryName === "string" ? body.newCategoryName.trim() : "";
  if (newName) {
    const clash = await prisma.category.findFirst({ where: { name: { equals: newName, mode: "insensitive" } } });
    if (clash) return { ok: false, error: `A category called "${clash.name}" already exists. Pick it from the list instead.` };
    const created = await prisma.category.create({
      data: { name: newName, reviewCycleDays: 90, formSchema: [], createdById: userId },
    });
    return { ok: true, id: created.id, name: created.name };
  }
  if (typeof body.toCategoryId !== "string" || !body.toCategoryId) {
    return { ok: false, error: "Choose where to move the documents." };
  }
  if (body.toCategoryId === sourceId) return { ok: false, error: "Choose a different category." };
  const target = await prisma.category.findUnique({ where: { id: body.toCategoryId } });
  if (!target || target.isSystem) return { ok: false, error: "That category doesn't exist." };
  return { ok: true, id: target.id, name: target.name };
}

/** Moves documents whose main category is sourceId to targetId. Pass
 * documentIds to move only those, or null for every document in the
 * category (deleted ones included, so nothing is left pointing at it).
 * Their detail-field answers are kept as they are: the new category's
 * fields can be filled in later from each document's edit form. */
export async function moveCategoryDocuments(sourceId: string, targetId: string, targetName: string, documentIds: string[] | null) {
  const docs = await prisma.document.findMany({
    where: { categoryId: sourceId, ...(documentIds ? { id: { in: documentIds } } : {}) },
    select: { id: true, title: true },
  });
  if (docs.length === 0) return docs;
  const ids = docs.map((d) => d.id);
  await prisma.$transaction([
    // Already "also shown in" the target: that becomes its main category now.
    prisma.documentCategory.deleteMany({ where: { documentId: { in: ids }, categoryId: targetId } }),
    prisma.document.updateMany({ where: { id: { in: ids } }, data: { categoryId: targetId } }),
  ]);
  // The search index keys documents to their category by name. Only
  // documents already in the index are touched: a partial update would
  // otherwise add a half-empty entry for an unpublished one.
  try {
    const moved = new Set(ids);
    const indexed = await allIndexedCategoryNames();
    await setIndexedCategoryName(indexed.filter((d) => moved.has(d.id)).map((d) => d.id), targetName);
  } catch (err) {
    console.error(`Could not carry the move to "${targetName}" into the search index:`, err);
  }
  return docs;
}
