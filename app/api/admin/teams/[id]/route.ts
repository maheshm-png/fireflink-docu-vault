import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

// PATCH /api/admin/teams/:id — superadmin renames an option. Every user
// currently holding it (the FK is by id, not name) picks up the new name
// automatically, nothing else to update.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  const trimmed = name.trim();

  const existing = await prisma.team.findUnique({ where: { name: trimmed } });
  if (existing && existing.id !== params.id) {
    return NextResponse.json({ error: "Another team already has that name." }, { status: 409 });
  }

  const team = await prisma.team.update({ where: { id: params.id }, data: { name: trimmed } });
  return NextResponse.json(team);
}

// DELETE /api/admin/teams/:id — superadmin removes a team. Memberships go
// with it (UserTeam cascades). Refused while the team still guards any
// restricted document: deleting it would leave those documents visible to
// nobody but their stakeholders (DocumentTeamAccess.team is Restrict).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageTeams");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const guarded = await prisma.documentTeamAccess.count({ where: { teamId: params.id } });
  if (guarded > 0) {
    return NextResponse.json(
      {
        error: `This team guards ${guarded} restricted document${guarded === 1 ? "" : "s"}, so it can't be deleted yet. Move those documents to another team or make them visible to everyone first.`,
      },
      { status: 409 }
    );
  }

  await prisma.team.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
