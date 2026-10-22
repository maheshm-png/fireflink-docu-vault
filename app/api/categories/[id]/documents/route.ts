import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { moveCategoryDocuments, resolveMoveTarget } from "@/lib/categoryMove";

async function guard() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  try {
    assertCan(user.role, "manageCategories");
  } catch (e: any) {
    return { error: NextResponse.json({ error: e.message }, { status: e.status ?? 403 }) };
  }
  return { user };
}

// GET /api/categories/:id/documents — the documents whose main category
// this is, for the Categories page's "Move documents" picker.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const g = await guard();
  if (g.error) return g.error;
  const documents = await prisma.document.findMany({
    where: { categoryId: params.id, deletedAt: null },
    orderBy: { title: "asc" },
    select: { id: true, title: true, status: true },
  });
  return NextResponse.json({ documents });
}

// POST /api/categories/:id/documents — moves documents out of this
// category. body: { documentIds: string[], toCategoryId? , newCategoryName? }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const g = await guard();
  if (g.error) return g.error;
  const user = g.user!;

  const source = await prisma.category.findUnique({ where: { id: params.id } });
  if (!source || source.isSystem) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { documentIds } = body;
  if (!Array.isArray(documentIds) || documentIds.length === 0 || documentIds.some((d: unknown) => typeof d !== "string")) {
    return NextResponse.json({ error: "Choose at least one document to move." }, { status: 400 });
  }

  const target = await resolveMoveTarget(user.id, source.id, body);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  const moved = await moveCategoryDocuments(source.id, target.id, target.name, documentIds);
  for (const d of moved) {
    await logAudit({ userId: user.id, action: "category_move", documentId: d.id, documentTitle: d.title });
  }
  return NextResponse.json({ moved: moved.length, category: { id: target.id, name: target.name } });
}
