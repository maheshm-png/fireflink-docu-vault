import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { refreshIndexedAccess } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import { resolveGlobalCategory } from "@/lib/teamCategory";
import { canChangeDownloads, checkAccessChange, passesTeamGate, writeAccessChange, stakeSelect } from "@/lib/access";

// PATCH /api/documents/:id/access — change who can see a document, any time
// after upload (the Manage tab's AccessSettings).
//   { visibility: "org" }                         everyone in the org
//   { visibility: "restricted", teamIds: [...] }  only those teams
// The rules (who may restrict, who may open it back up, which teams they may
// add or remove) are lib/access.ts's checkAccessChange, the same check the
// approval step uses.
//   { downloadable: true | false }                 downloads on/off only
// (canChangeDownloads).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      visibility: true,
      teamAccess: { select: { teamId: true, grantedById: true } },
      ...stakeSelect,
    },
  });
  if (!document || document.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  if (typeof body.downloadable === "boolean" && body.visibility === undefined) {
    if (!canChangeDownloads(user, document)) {
      return NextResponse.json({ error: "Only a manager of this document can change downloads." }, { status: 403 });
    }
    await prisma.document.update({ where: { id: document.id }, data: { downloadable: body.downloadable } });
    await logAudit({ userId: user.id, action: "change_access", documentId: document.id, documentTitle: document.title });
    return NextResponse.json({ ok: true });
  }

  const { visibility, teamIds } = body;
  const check = await checkAccessChange(user, document, visibility, teamIds);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (!check.changed) return NextResponse.json({ ok: true, sharingTurnedOff: false });

  // A team document going to everyone joins a global category (lib/teamCategory.ts).
  let globalCategory: { categoryId: string; metadata: Record<string, unknown> } | undefined;
  if (document.visibility === "restricted" && check.visibility === "org") {
    const picked = await resolveGlobalCategory(body.categoryId, body.metadata);
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 });
    globalCategory = { categoryId: picked.categoryId, metadata: picked.metadata };
  }
  const { sharingTurnedOff } = await writeAccessChange(user, document.id, check.visibility, check.teamIds, globalCategory);
  await refreshIndexedAccess(document.id);
  await logAudit({ userId: user.id, action: "change_access", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true, sharingTurnedOff });
}
