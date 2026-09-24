import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// PATCH /api/documents/:id/feedback/:feedbackId/replies/:replyId — { comment }.
// The reply's own author ONLY, same restriction as editing a feedback
// comment's own text (app/api/documents/[id]/feedback/[feedbackId]/route.ts's
// PATCH) — rewriting someone else's wording, even as the manager/uploader
// who could triage this feedback, has no visible attribution that it
// happened, unlike a status change (already shown as "Accepted by X").
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; feedbackId: string; replyId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.feedbackReply.findUnique({ where: { id: params.replyId } });
  if (!existing || existing.feedbackId !== params.feedbackId) {
    return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  }
  if (existing.authorId !== user.id) {
    return NextResponse.json({ error: "You can only edit your own replies." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.comment !== "string" || !body.comment.trim()) {
    return NextResponse.json({ error: "Reply can't be empty." }, { status: 400 });
  }

  const reply = await prisma.feedbackReply.update({
    where: { id: params.replyId },
    data: { comment: body.comment.trim(), editedAt: new Date() },
    include: { author: { select: { name: true, role: true } } },
  });

  return NextResponse.json({
    reply: {
      id: reply.id,
      authorId: reply.authorId,
      authorName: reply.author.name,
      authorRole: reply.author.role,
      comment: reply.comment,
      editedAt: reply.editedAt,
      createdAt: reply.createdAt,
    },
  });
}
