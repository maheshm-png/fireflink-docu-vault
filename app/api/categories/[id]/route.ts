import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { dedupeFieldIds, type CategoryFormField } from "@/lib/formSchema";
import { prisma } from "@/lib/prisma";

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

  const category = await prisma.category.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(reviewCycleDays !== undefined ? { reviewCycleDays } : {}),
      ...(fields !== undefined ? { formSchema: fields } : {}),
    },
  });
  return NextResponse.json({ category });
}
