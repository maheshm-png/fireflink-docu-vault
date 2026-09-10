import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// DELETE /api/documents/:id/feedback/:feedbackId — the comment's own author
// can always remove it, and a manager/superadmin can additionally moderate
// (remove) anyone's, same reviewer-tier moderation reach this app already
// grants elsewhere (e.g. archiveDocument, revokeDocument in lib/rbac.ts).
// Unlike /comments' DELETE (app/api/documents/[id]/comments/[commentId]/
// route.ts), there's no "still pending" window restriction — this isn't
// tied to a review round, so it's removable any time.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; feedbackId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.documentFeedback.findUnique({ where: { id: params.feedbackId } });
  if (!existing || existing.documentId !== params.id) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const canModerate = user.role === "manager" || user.role === "superadmin";
  if (existing.userId !== user.id && !canModerate) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }

  await prisma.documentFeedback.delete({ where: { id: params.feedbackId } });
  return NextResponse.json({ ok: true });
}

// PATCH /api/documents/:id/feedback/:feedbackId — { comment } — edits the
// text of an already-added feedback comment. Same authorship/moderation
// reach as DELETE above: the comment's own author, or a manager/
// superadmin moderating someone else's.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; feedbackId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.documentFeedback.findUnique({ where: { id: params.feedbackId } });
  if (!existing || existing.documentId !== params.id) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const canModerate = user.role === "manager" || user.role === "superadmin";
  if (existing.userId !== user.id && !canModerate) {
    return NextResponse.json({ error: "You can only edit your own comments." }, { status: 403 });
  }

  const { comment } = await req.json();
  if (typeof comment !== "string" || !comment.trim()) {
    return NextResponse.json({ error: "Comment can't be empty." }, { status: 400 });
  }

  const updated = await prisma.documentFeedback.update({
    where: { id: params.feedbackId },
    data: { comment: comment.trim(), editedAt: new Date() },
    include: { user: { select: { name: true } } },
  });

  return NextResponse.json({ feedback: updated });
}
