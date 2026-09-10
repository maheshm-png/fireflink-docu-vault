import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/feedback — { highlightedText, comment }
// Open feedback from ANY authenticated user — not gated by review
// assignment like /comments (app/api/documents/[id]/comments/route.ts) is.
// Only usable once the publishing manager opted this specific document into
// it (Document.feedbackEnabled — set at publish time, see ReviewActions.tsx
// and app/api/documents/[id]/review/route.ts), and only while it's actually
// published — a revoked/archived/deleted document stops accepting new
// feedback even if it was enabled while live.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    select: { deletedAt: true, status: true, feedbackEnabled: true },
  });
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (document.status !== "published" || !document.feedbackEnabled) {
    return NextResponse.json({ error: "Feedback isn't open on this document." }, { status: 403 });
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

  const created = await prisma.documentFeedback.create({
    data: {
      documentId: params.id,
      userId: user.id,
      highlightedText: trimmedSelection || null,
      comment: comment.trim(),
    },
    include: { user: { select: { name: true } } },
  });

  return NextResponse.json({ feedback: created }, { status: 201 });
}
