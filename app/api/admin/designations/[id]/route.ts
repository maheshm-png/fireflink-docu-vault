import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// PATCH /api/admin/designations/:id — superadmin renames an option. Every
// user currently holding it (the FK is by id, not name) picks up the new
// name automatically, nothing else to update.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageDesignations");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  const trimmed = name.trim();

  const existing = await prisma.designation.findUnique({ where: { name: trimmed } });
  if (existing && existing.id !== params.id) {
    return NextResponse.json({ error: "Another designation already has that name." }, { status: 409 });
  }

  const designation = await prisma.designation.update({ where: { id: params.id }, data: { name: trimmed } });
  return NextResponse.json(designation);
}

// DELETE /api/admin/designations/:id — superadmin removes an option.
// Anyone currently holding it just goes back to no designation set (the FK
// is nullable, ON DELETE SET NULL — see the migration) rather than blocking
// the delete.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageDesignations");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  await prisma.designation.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
