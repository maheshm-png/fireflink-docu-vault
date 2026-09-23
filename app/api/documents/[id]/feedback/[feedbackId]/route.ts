import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { notifyFeedbackAccepted, fireNotification } from "@/lib/notify";
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

const FEEDBACK_STATUSES = ["open", "accepted", "closed"];

// PATCH /api/documents/:id/feedback/:feedbackId — { comment? } and/or
// { status?, responseNote? }, at least one of comment/status. Two
// independent capabilities live in this one handler because they're two
// edits to the same row, but with different authorization:
//   - comment: the comment's own author ONLY, even for a manager/
//     superadmin — unlike DELETE above, rewriting someone else's wording
//     silently puts words in their mouth with no visible attribution that
//     it happened, unlike a delete (the comment's just gone) or a status
//     change (already shown as "Accepted/Closed by X"). Moderation here
//     stays to removing or triaging, never editing what someone else said.
//   - status (+ its optional responseNote reply): triaging feedback as
//     accepted/closed is a document-management action, not a self-edit —
//     open to a manager/superadmin OR this specific document's own uploader
//     (see FeedbackManagement.tsx), even if neither of them wrote the
//     comment being triaged. Setting status to "accepted" (when it wasn't
//     already) notifies the feedback's own author — see notifyFeedbackAccepted.
export async function PATCH(
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
  const body = await req.json();
  const data: {
    comment?: string;
    editedAt?: Date;
    status?: "open" | "accepted" | "closed";
    responseNote?: string | null;
    statusChangedById?: string;
  } = {};

  if (body.comment !== undefined) {
    if (existing.userId !== user.id) {
      return NextResponse.json({ error: "You can only edit your own comments." }, { status: 403 });
    }
    if (typeof body.comment !== "string" || !body.comment.trim()) {
      return NextResponse.json({ error: "Comment can't be empty." }, { status: 400 });
    }
    data.comment = body.comment.trim();
    data.editedAt = new Date();
  }

  if (body.status !== undefined) {
    const canTriage = isManager || existing.document.uploadedById === user.id;
    if (!canTriage) {
      return NextResponse.json(
        { error: "Only the document's contributor or a manager can update feedback status." },
        { status: 403 }
      );
    }
    // Whoever left the feedback can't also be the one who accepts or closes
    // it — triage is meant to be someone else's call on what they wrote, not
    // a self-assessment. A manager/contributor who happens to have also
    // authored this particular comment has to have someone else (another
    // manager, or the document's contributor if they weren't the author)
    // triage it instead.
    if (existing.userId === user.id) {
      return NextResponse.json({ error: "You can't accept or close your own feedback." }, { status: 403 });
    }
    if (typeof body.status !== "string" || !FEEDBACK_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    data.status = body.status as "open" | "accepted" | "closed";
    data.statusChangedById = user.id;
    if (body.responseNote !== undefined) {
      if (body.responseNote !== null && typeof body.responseNote !== "string") {
        return NextResponse.json({ error: "Invalid response note." }, { status: 400 });
      }
      data.responseNote = typeof body.responseNote === "string" ? body.responseNote.trim() || null : null;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.documentFeedback.update({
    where: { id: params.feedbackId },
    data,
    include: { user: { select: { name: true } }, statusChangedBy: { select: { name: true, role: true } } },
  });

  if (data.status === "accepted" && existing.status !== "accepted" && existing.userId !== user.id) {
    fireNotification(
      notifyFeedbackAccepted({
        documentTitle: existing.document.title,
        documentId: params.id,
        authorId: existing.userId,
        acceptedByName: user.name,
        responseNote: updated.responseNote,
      })
    );
  }

  return NextResponse.json({ feedback: updated });
}
