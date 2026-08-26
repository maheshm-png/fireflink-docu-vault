import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { removeFromIndex } from "@/lib/search";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/archive — manager retires a settled document
// (published, rejected, or revoked) into the Archived section without
// deleting it. Unlike revoke, this doesn't reopen a review — it's a quiet
// housekeeping action, so it deliberately sends no notification (see the
// notification policy comment in lib/notify.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "archiveDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  if (!["published", "rejected", "revoked"].includes(document.status)) {
    return NextResponse.json({ error: "Only published, rejected, or revoked documents can be archived" }, { status: 400 });
  }

  if (document.status === "published") {
    await removeFromIndex(document.id);
  }

  await prisma.document.update({ where: { id: document.id }, data: { status: "archived" } });

  await logAudit({ userId: user.id, action: "archive", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
