import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { dedupeFieldIds, isFormSchema, parseReviewCycleDays, type CategoryFormField } from "@/lib/formSchema";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Global categories only: the built-in team category is never offered.
  const categories = await prisma.category.findMany({ where: { isSystem: false }, orderBy: { name: "asc" } });
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

  const { name: rawName, description, reviewCycleDays, formSchema } = await req.json().catch(() => ({}));
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return NextResponse.json({ error: "Category name is required" }, { status: 400 });
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json({ error: "Description must be text." }, { status: 400 });
  }
  const cycle = reviewCycleDays === undefined ? 90 : parseReviewCycleDays(reviewCycleDays);
  if (cycle === undefined) {
    return NextResponse.json({ error: "Review cycle must be a whole number of days (1 to 3650), or none." }, { status: 400 });
  }
  if (formSchema !== undefined && !isFormSchema(formSchema)) {
    return NextResponse.json({ error: "The upload form's fields are malformed." }, { status: 400 });
  }
  if (await prisma.category.findUnique({ where: { name } })) {
    return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
  }

  const fields: CategoryFormField[] = dedupeFieldIds(formSchema ?? []);

  const category = await prisma.category.create({
    data: {
      name,
      description,
      reviewCycleDays: cycle,
      formSchema: fields,
      createdById: user.id,
    },
  });
  return NextResponse.json({ category }, { status: 201 });
}
