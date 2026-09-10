import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// DELETE /api/documents/:id/comments/:commentId — lets a reviewer remove
// their own inline comment (a typo, wrong selection, changed their mind)
// before it's swept into a decision notice. Only the comment's own author
// can delete it, and only while their review round is still pending — once
// a decision's been submitted, that round's comments are historical record.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.inlineComment.findUnique({
    where: { id: params.commentId },
    include: { reviewRequest: true },
  });
  if (!existing || existing.documentId !== params.id) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }
  if (existing.reviewerId !== user.id) {
    return NextResponse.json({ error: "You can only delete your own comments." }, { status: 403 });
  }
  if (existing.reviewRequest.status !== "pending") {
    return NextResponse.json({ error: "This review round is already resolved." }, { status: 400 });
  }

  await prisma.inlineComment.delete({ where: { id: params.commentId } });
  return NextResponse.json({ ok: true });
}

// PATCH /api/documents/:id/comments/:commentId — { comment } — edits the
// text of an already-added inline comment. Same authorship/timing rule as
// DELETE above: only the comment's own author, only while their review
// round is still pending.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.inlineComment.findUnique({
    where: { id: params.commentId },
    include: { reviewRequest: true },
  });
  if (!existing || existing.documentId !== params.id) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }
  if (existing.reviewerId !== user.id) {
    return NextResponse.json({ error: "You can only edit your own comments." }, { status: 403 });
  }
  if (existing.reviewRequest.status !== "pending") {
    return NextResponse.json({ error: "This review round is already resolved." }, { status: 400 });
  }

  const { comment } = await req.json();
  if (typeof comment !== "string" || !comment.trim()) {
    return NextResponse.json({ error: "Comment can't be empty." }, { status: 400 });
  }

  const updated = await prisma.inlineComment.update({
    where: { id: params.commentId },
    data: { comment: comment.trim(), editedAt: new Date() },
  });

  return NextResponse.json({ comment: updated });
}
