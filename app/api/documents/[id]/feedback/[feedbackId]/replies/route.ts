import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { notifyFeedbackReplied, fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/feedback/:feedbackId/replies — { comment }. A
// follow-up message after the first accept/close decision (the PATCH route
// next door handles that first one, tied to status+responseNote). Once
// that's done, going back and forth shouldn't force picking a status again
// each time, so this is a plain append-only thread: same canTriage
// authorization as the status change (manager/superadmin, or this
// document's own uploader), same "not your own feedback" restriction, but
// no status field involved at all.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; feedbackId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.documentFeedback.findUnique({
    where: { id: params.feedbackId },
    include: { document: { select: { uploadedById: true, title: true } } },
  });
  if (!existing || existing.documentId !== params.id) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  const isManager = user.role === "manager" || user.role === "superadmin";
  const canTriage = isManager || existing.document.uploadedById === user.id;
  if (!canTriage) {
    return NextResponse.json(
      { error: "Only the document's contributor or a manager can reply to feedback." },
      { status: 403 }
    );
  }
  if (existing.userId === user.id) {
    return NextResponse.json({ error: "You can't reply to your own feedback." }, { status: 403 });
  }
  // The first reply is the accept/close decision itself (PATCH, above) —
  // that's the one action this feedback's author is actually waiting on.
  // Until it's been made, there's nothing yet for a follow-up to follow up
  // on.
  if (existing.status === "open") {
    return NextResponse.json(
      { error: "Accept or close this feedback first, then you can send follow-up replies." },
      { status: 400 }
    );
  }
  // Closed is treated as done, not just another ongoing state — no new
  // reply until it's reopened (a PATCH back to status "open"), matching the
  // client's own disabled compose row for this case.
  if (existing.status === "closed") {
    return NextResponse.json(
      { error: "This feedback is closed. Reopen it before sending another reply." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.comment !== "string" || !body.comment.trim()) {
    return NextResponse.json({ error: "Reply can't be empty." }, { status: 400 });
  }

  const reply = await prisma.feedbackReply.create({
    data: { feedbackId: params.feedbackId, authorId: user.id, comment: body.comment.trim() },
    include: { author: { select: { name: true, role: true } } },
  });

  fireNotification(
    notifyFeedbackReplied({
      documentTitle: existing.document.title,
      documentId: params.id,
      authorId: existing.userId,
      repliedByName: user.name,
      comment: reply.comment,
    })
  );

  // Flattened to the {id, authorId, authorName, authorRole, comment,
  // editedAt, createdAt} shape components/DocumentFeedback.tsx's
  // FeedbackReplyItem expects, same as the PATCH route's own replies list —
  // not Prisma's nested `{ author: { name, role } }`, which would render
  // with no author name/role until a refresh.
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
