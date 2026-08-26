import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { dedupeFieldIds, type CategoryFormField } from "@/lib/formSchema";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(categories);
}

// POST /api/categories — manager/superadmin only, creates a new domain/category
// body: { name, description?, reviewCycleDays?, formSchema?: CategoryFormField[] }
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageCategories");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { name, description, reviewCycleDays, formSchema } = await req.json();
  if (!name) return NextResponse.json({ error: "Category name is required" }, { status: 400 });

  const fields: CategoryFormField[] = dedupeFieldIds(formSchema ?? []);

  const category = await prisma.category.create({
    data: {
      name,
      description,
      reviewCycleDays: reviewCycleDays === undefined ? 90 : reviewCycleDays,
      formSchema: fields,
      createdById: user.id,
    },
  });
  return NextResponse.json({ category }, { status: 201 });
}
