import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// GET /api/admin/designations — any authenticated user (needed to populate
// the designation dropdown wherever it's shown, e.g. Manage Users).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const designations = await prisma.designation.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(designations);
}

// POST /api/admin/designations — superadmin adds a new option to the list.
export async function POST(req: NextRequest) {
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

  const existing = await prisma.designation.findUnique({ where: { name: name.trim() } });
  if (existing) {
    return NextResponse.json({ error: "That designation already exists." }, { status: 409 });
  }

  const designation = await prisma.designation.create({ data: { name: name.trim() } });
  return NextResponse.json(designation, { status: 201 });
}
