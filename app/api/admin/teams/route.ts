import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// GET /api/admin/teams — any authenticated user (needed to populate the
// team dropdown wherever it's shown, e.g. Manage Users).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teams = await prisma.team.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(teams);
}

// POST /api/admin/teams — superadmin adds a new option to the list.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageTeams");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const existing = await prisma.team.findUnique({ where: { name: name.trim() } });
  if (existing) {
    return NextResponse.json({ error: "That team already exists." }, { status: 409 });
  }

  const team = await prisma.team.create({ data: { name: name.trim() } });
  return NextResponse.json(team, { status: 201 });
}
