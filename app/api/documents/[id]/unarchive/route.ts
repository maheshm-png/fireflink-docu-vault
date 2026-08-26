import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/unarchive — manager restores an archived document
// back into the review queue. Re-publishing after a stint in the archive
// still has to earn its way through approval again, same as revoke.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "archiveDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  if (document.status !== "archived") {
    return NextResponse.json({ error: "Only archived documents can be unarchived" }, { status: 400 });
  }

  await prisma.document.update({ where: { id: document.id }, data: { status: "pending_review" } });

  await prisma.reviewRequest.create({
    data: {
      documentId: document.id,
      requestedById: user.id,
      reviewerId: document.ownerId,
    },
  });

  await logAudit({ userId: user.id, action: "unarchive", documentId: document.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
