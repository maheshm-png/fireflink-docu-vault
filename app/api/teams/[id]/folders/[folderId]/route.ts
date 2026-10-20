import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canManageFolders, canSeeTeam } from "@/lib/access";
import { cleanFolderName, MAX_FOLDER_NAME } from "@/lib/teamFolders";

// PATCH { name }  rename a folder;  DELETE  remove it (its documents stay,
// just out of any folder). The team's managers and superadmins only.
async function gate(teamId: string, folderId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const folder = await prisma.teamFolder.findUnique({ where: { id: folderId } });
  if (!folder || folder.teamId !== teamId || !canSeeTeam(user, teamId)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!canManageFolders(user, teamId)) {
    return { error: NextResponse.json({ error: "Only a manager of this team can change folders." }, { status: 403 }) };
  }
  return { user, folder };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; folderId: string } }) {
  const g = await gate(params.id, params.folderId);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const name = cleanFolderName(body.name);
  if (!name) return NextResponse.json({ error: `Give the folder a name of up to ${MAX_FOLDER_NAME} characters.` }, { status: 400 });
  const clash = await prisma.teamFolder.findUnique({ where: { teamId_name: { teamId: params.id, name } } });
  if (clash && clash.id !== g.folder.id) {
    return NextResponse.json({ error: "This team already has a folder with that name." }, { status: 409 });
  }
  await prisma.teamFolder.update({ where: { id: g.folder.id }, data: { name } });
  await logAudit({ userId: g.user.id, action: "team_folder_change" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; folderId: string } }) {
  const g = await gate(params.id, params.folderId);
  if ("error" in g) return g.error;
  // onDelete: SetNull takes every document in it out of the folder.
  await prisma.teamFolder.delete({ where: { id: g.folder.id } });
  await logAudit({ userId: g.user.id, action: "team_folder_change" });
  return NextResponse.json({ ok: true });
}
