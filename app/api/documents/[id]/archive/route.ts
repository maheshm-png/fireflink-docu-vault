import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { removeFromIndex } from "@/lib/search";
import { logAudit } from "@/lib/audit";
import { notifyDocumentRevoked, fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { documentRoleById, passesTeamGate, usersWhoCanSeeWhere } from "@/lib/access";

// POST /api/documents/:id/archive — manager takes a settled document
// (published, rejected, or back in review) out of circulation without
// deleting it. The one "take it down" action: it replaced Revoke
// (2026-10-12). Restoring it (unarchive) sends it back through review.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Team documents use the caller's team role (lib/access.ts documentRole).
    assertCan(await documentRoleById(user, params.id), "archiveDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { teamAccess: { select: { teamId: true } } },
  });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted. Restore it first." }, { status: 409 });
  }

  if (!["published", "rejected", "revoked"].includes(document.status)) {
    return NextResponse.json({ error: "Only published, rejected, or revoked documents can be archived" }, { status: 400 });
  }

  // Optional note saying why, shown to everyone who opens it while archived.
  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";

  if (document.status === "published") {
    await removeFromIndex(document.id);
  }

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "archived", archiveNote: note || null, archivedAt: new Date(), archivedById: user.id },
  });

  await logAudit({ userId: user.id, action: "archive", documentId: document.id, documentTitle: document.title });

  // Archiving a live document withdraws it: everyone who could see it is
  // told to stop using any copy (this replaced the separate Revoke action).
  if (document.status === "published") {
    const recipients = await prisma.user.findMany({
      where: { AND: [{ isActive: true }, usersWhoCanSeeWhere(document)] },
      select: { id: true, name: true },
    });
    fireNotification(notifyDocumentRevoked({ documentTitle: document.title, documentId: document.id, recipients, note: note || undefined }));
  }

  return NextResponse.json({ ok: true });
}
