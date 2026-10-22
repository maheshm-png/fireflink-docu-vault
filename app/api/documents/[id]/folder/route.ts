import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canFileIntoFolders, passesTeamGate } from "@/lib/access";

// PATCH /api/documents/:id/folder — { teamId, folderId: string | null }
// Files a team document into one of that team's folders (null = no folder).
// The team's contributors and managers, and superadmins.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { teamId, folderId } = await req.json().catch(() => ({}));
  if (typeof teamId !== "string" || (folderId !== null && typeof folderId !== "string")) {
    return NextResponse.json({ error: "Send teamId and folderId (or null)." }, { status: 400 });
  }
  if (!canFileIntoFolders(user, teamId)) {
    return NextResponse.json({ error: "Only a contributor or manager of this team can move its documents between folders." }, { status: 403 });
  }
  const access = await prisma.documentTeamAccess.findUnique({
    where: { documentId_teamId: { documentId: params.id, teamId } },
    include: { document: { select: { title: true } } },
  });
  if (!access) return NextResponse.json({ error: "This document isn't shared with that team." }, { status: 400 });
  if (folderId) {
    const folder = await prisma.teamFolder.findUnique({ where: { id: folderId }, select: { teamId: true } });
    if (!folder || folder.teamId !== teamId) {
      return NextResponse.json({ error: "That folder belongs to another team." }, { status: 400 });
    }
  }

  await prisma.documentTeamAccess.update({
    where: { documentId_teamId: { documentId: params.id, teamId } },
    data: { folderId },
  });
  await logAudit({ userId: user.id, action: "team_folder_change", documentId: params.id, documentTitle: access.document.title });
  return NextResponse.json({ ok: true });
}
