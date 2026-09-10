import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/comments — { highlightedText, comment }
// Adds an inline comment tied to the caller's own active pending review
// round for this document — same "must actually hold an active assignment"
// rule as app/api/documents/[id]/review/route.ts enforces for acting on a
// review at all. Not sent anywhere yet (no GChat/email here) — that only
// happens in a batch when the review decision is submitted, see
// notifyReviewDecision's inlineComments param.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const myRequest = await prisma.reviewRequest.findFirst({
    where: { documentId: params.id, reviewerId: user.id, status: "pending" },
  });
  if (!myRequest) {
    return NextResponse.json(
      { error: "You don't currently have an active review assignment for this document." },
      { status: 403 }
    );
  }

  const { highlightedText, comment } = await req.json();
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

  const trimmedSelection = typeof highlightedText === "string" ? highlightedText.trim() : "";

  const created = await prisma.inlineComment.create({
    data: {
      documentId: params.id,
      reviewRequestId: myRequest.id,
      reviewerId: user.id,
      highlightedText: trimmedSelection || null,
      comment: comment.trim(),
    },
  });

  return NextResponse.json({ comment: created }, { status: 201 });
}
