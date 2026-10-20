import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { dedupeFieldIds, type CategoryFormField } from "@/lib/formSchema";
import { prisma } from "@/lib/prisma";
import { allIndexedCategoryNames, setIndexedCategoryName } from "@/lib/search";
import { moveCategoryDocuments, resolveMoveTarget } from "@/lib/categoryMove";
import { logAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const category = await prisma.category.findUniqueOrThrow({ where: { id: params.id } });
  return NextResponse.json(category);
}

// PATCH /api/categories/:id — edit name/description/review cycle/upload form.
// Editing the form schema only affects future uploads — past documents keep
// whatever metadata they were submitted with.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageCategories");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { name, description, reviewCycleDays, formSchema } = await req.json();
  const fields: CategoryFormField[] | undefined = formSchema ? dedupeFieldIds(formSchema) : undefined;

  const before = await prisma.category.findUniqueOrThrow({ where: { id: params.id }, select: { name: true, isSystem: true } });
  // The built-in team category (lib/teamCategory.ts) isn't editable.
  if (before.isSystem) return NextResponse.json({ error: "This built-in category can't be changed." }, { status: 400 });

  const category = await prisma.category.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(reviewCycleDays !== undefined ? { reviewCycleDays } : {}),
      ...(fields !== undefined ? { formSchema: fields } : {}),
    },
  });
  // The search index keys documents to their category by name, so a
  // rename has to be carried over to every indexed document in it or they
  // all drop out of the renamed tab (see setIndexedCategoryName).
  if (category.name !== before.name) {
    try {
      const [docs, indexed] = await Promise.all([
        prisma.document.findMany({ where: { categoryId: category.id }, select: { id: true } }),
        allIndexedCategoryNames(),
      ]);
      const inCategory = new Set(docs.map((d) => d.id));
      await setIndexedCategoryName(
        indexed.filter((d) => inCategory.has(d.id)).map((d) => d.id),
        category.name
      );
    } catch (err) {
      console.error(`Could not carry category rename "${before.name}" -> "${category.name}" into the search index:`, err);
    }
  }

  return NextResponse.json({ category });
}

// DELETE /api/categories/:id — manager/superadmin only. A category that
// still has documents needs somewhere to move them first, given in the
// body as { toCategoryId } or { newCategoryName } (lib/categoryMove.ts).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageCategories");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const category = await prisma.category.findUnique({ where: { id: params.id } });
  if (!category) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (category.isSystem) return NextResponse.json({ error: "This built-in category can't be deleted." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const docCount = await prisma.document.count({ where: { categoryId: category.id } });
  if (docCount > 0) {
    const target = await resolveMoveTarget(user.id, category.id, body);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
    const moved = await moveCategoryDocuments(category.id, target.id, target.name, null);
    for (const d of moved) {
      await logAudit({ userId: user.id, action: "category_move", documentId: d.id, documentTitle: d.title });
    }
  }

  // Filters saved on this category's tab would point at nothing.
  await prisma.$transaction([
    prisma.savedFilter.deleteMany({ where: { section: `published:${category.id}` } }),
    prisma.category.delete({ where: { id: category.id } }),
  ]);
  await logAudit({ userId: user.id, action: "category_delete", documentTitle: `Category: ${category.name}` });

  return NextResponse.json({ ok: true });
}
