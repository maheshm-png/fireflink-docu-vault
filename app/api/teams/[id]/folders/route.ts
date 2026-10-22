import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canManageFolders, canSeeTeam } from "@/lib/access";
import { cleanFolderName, MAX_FOLDER_NAME } from "@/lib/teamFolders";

// Folders inside one team's documents (Home > My teams).
//   GET            the team's folders (anyone who can see the team)
//   POST { name }  create one (the team's managers, superadmins)

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeeTeam(user, params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const folders = await prisma.teamFolder.findMany({
    where: { teamId: params.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeeTeam(user, params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageFolders(user, params.id)) {
    return NextResponse.json({ error: "Only a manager of this team can create folders." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const name = cleanFolderName(body.name);
  if (!name) return NextResponse.json({ error: `Give the folder a name of up to ${MAX_FOLDER_NAME} characters.` }, { status: 400 });

  const exists = await prisma.teamFolder.findUnique({ where: { teamId_name: { teamId: params.id, name } } });
  if (exists) return NextResponse.json({ error: "This team already has a folder with that name." }, { status: 409 });

  const folder = await prisma.teamFolder.create({
    data: { teamId: params.id, name, createdById: user.id },
    select: { id: true, name: true },
  });
  await logAudit({ userId: user.id, action: "team_folder_change" });
  return NextResponse.json({ folder }, { status: 201 });
}
