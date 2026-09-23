import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { notifyFeedbackTagged, fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/feedback — { highlightedText, comment }
// Open feedback from ANY authenticated user — not gated by review
// assignment like /comments (app/api/documents/[id]/comments/route.ts) is.
// Only usable once the publishing manager opted this specific document into
// it (Document.feedbackEnabled — set at publish time, see ReviewActions.tsx
// and app/api/documents/[id]/review/route.ts, or toggled later via this
// route's own PATCH below), and only while it's actually publicly visible —
// same rule app/dashboard/documents/[id]/page.tsx uses for the page-access
// gate and the Feedback tab itself (isPubliclyVisible/hasEverPublished):
// a document simply back in re-review after already being published once
// (status pending_review or rejected, but it has a real approved version
// behind it) still accepts feedback on that still-live version, it's only a
// revoked/archived/deleted document that stops. Checking the raw
// document.status === "published" here used to reject every attempt while
// a new version was mid-review, even though the page itself still showed
// the Feedback tab as open.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    include: { versions: { select: { id: true, versionNumber: true, uploadedAt: true } } },
  });
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId: document.id },
    select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewerId: true },
  });
  const hasEverPublished =
    document.currentVersionId !== null &&
    everApprovedVersionIds(document.versions, reviewRequests, document.revokedAt).has(document.currentVersionId);
  const isPubliclyVisible = hasEverPublished && document.status !== "revoked" && document.status !== "archived";

  if (!isPubliclyVisible || !document.feedbackEnabled) {
    return NextResponse.json({ error: "Feedback isn't open on this document." }, { status: 403 });
  }

  const { highlightedText, comment, taggedUserId } = await req.json();
  // A document with nothing extracted to highlight (an external link, a
  // video) falls back to a plain, unanchored comment — see
  // components/HighlightCommentPanel.tsx — so an empty/absent
  // highlightedText is valid, not an error, as long as it's the right type
  // when present at all.
  if (highlightedText !== undefined && highlightedText !== null && typeof highlightedText !== "string") {
    return NextResponse.json({ error: "Invalid selection." }, { status: 400 });
  }
  if (typeof comment !== "string" || !comment.trim()) {
    return NextResponse.json({ error: "Comment can't be empty." }, { status: 400 });
  }

  // The tag target has to actually be someone with a real stake in THIS
  // document — its contributor, or one of its reviewers across any round —
  // never an arbitrary user id someone could hand-craft into the request.
  // Same "who's involved" set components/DocumentFeedback.tsx's picker is
  // built from.
  let validTaggedUserId: string | null = null;
  if (taggedUserId !== undefined && taggedUserId !== null) {
    if (typeof taggedUserId !== "string") {
      return NextResponse.json({ error: "Invalid tag." }, { status: 400 });
    }
    const taggableIds = new Set([document.uploadedById, ...reviewRequests.map((r) => r.reviewerId)]);
    if (!taggableIds.has(taggedUserId)) {
      return NextResponse.json({ error: "You can only tag this document's contributor or a reviewer." }, { status: 400 });
    }
    validTaggedUserId = taggedUserId;
  }

  const trimmedSelection = typeof highlightedText === "string" ? highlightedText.trim() : "";
  const trimmedComment = comment.trim();

  const created = await prisma.documentFeedback.create({
    data: {
      documentId: params.id,
      userId: user.id,
      highlightedText: trimmedSelection || null,
      comment: trimmedComment,
      taggedUserId: validTaggedUserId,
    },
    include: { user: { select: { name: true } }, taggedUser: { select: { name: true, role: true } } },
  });

  if (validTaggedUserId && validTaggedUserId !== user.id) {
    fireNotification(
      notifyFeedbackTagged({
        documentTitle: document.title,
        documentId: document.id,
        taggedUserId: validTaggedUserId,
        authorName: user.name,
        comment: trimmedComment,
      })
    );
  }

  return NextResponse.json({ feedback: created }, { status: 201 });
}

// PATCH /api/documents/:id/feedback — { feedbackEnabled: boolean }
// Lets a manager/superadmin or this document's own uploader turn feedback
// collection on or off any time after publish, not just the one-time choice
// made at approval (see ReviewActions.tsx's announce/feedback prompt) — for
// "we're done collecting input on this one, stop taking new comments"
// without needing a manager to revoke and republish just to flip that flag.
// Existing feedback already left is never affected either way; this only
// gates whether POST above accepts new comments going forward.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    select: { deletedAt: true, uploadedById: true },
  });
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const canManage = user.role === "manager" || user.role === "superadmin" || document.uploadedById === user.id;
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { feedbackEnabled } = await req.json();
  if (typeof feedbackEnabled !== "boolean") {
    return NextResponse.json({ error: "feedbackEnabled must be true or false." }, { status: 400 });
  }

  await prisma.document.update({ where: { id: params.id }, data: { feedbackEnabled } });
  return NextResponse.json({ ok: true });
}
