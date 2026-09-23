"use client";

import { MessageSquarePlus } from "lucide-react";
import HighlightCommentPanel, { type PanelItem } from "./HighlightCommentPanel";
import PdfHighlightViewer from "./PdfHighlightViewer";

type Comment = {
  id: string;
  highlightedText: string | null;
  comment: string;
  reviewerId: string;
  editedAt?: string | null;
};

/**
 * Lets the current reviewer select a passage directly on the actual
 * rendered document (page by page, via PdfHighlightViewer — real pdf.js
 * text-layer selection, not extracted text) and attach a comment to it,
 * additive to the single decision-time Comments box in ReviewActions.tsx,
 * not a replacement. Comments made here aren't sent anywhere on their own;
 * app/api/documents/[id]/review/route.ts bundles this round's comments
 * into the approve/reject GChat + email notice when the reviewer actually
 * submits their decision.
 *
 * Falls back to HighlightCommentPanel's plain extracted-text highlighting
 * only when there's no PDF to render at all (a raw video/link/other
 * document, or a PPT/Excel/Word whose LibreOffice conversion failed) —
 * `hasPdf` decides which.
 *
 * Only shown to the reviewer currently holding the pending assignment (see
 * app/dashboard/documents/[id]/page.tsx's canReview/myPendingReview), so
 * every item here always belongs to `myUserId` — no author byline needed.
 */
export default function InlineCommentReview({
  documentId,
  version,
  hasPdf,
  extractedText,
  myUserId,
  initialComments,
}: {
  documentId: string;
  // The specific version actually awaiting this review round — NOT
  // necessarily Document.currentVersion, which during a pending review is
  // still the previously-published (or, on a document's first-ever
  // review, nonexistent) version, not the new one this reviewer is
  // actually looking at. Undefined for a docType "link" document, which
  // never has any versions at all — hasPdf is always false in that case,
  // so it's simply never read.
  version?: number;
  hasPdf: boolean;
  extractedText: string;
  myUserId: string;
  initialComments: Comment[];
}) {
  const initialItems: PanelItem[] = initialComments.map((c) => ({
    id: c.id,
    highlightedText: c.highlightedText,
    comment: c.comment,
    authorId: c.reviewerId,
    canDelete: c.reviewerId === myUserId,
    canEdit: c.reviewerId === myUserId,
    editedAt: c.editedAt,
  }));

  async function onAdd(payload: { highlightedText: string | null; comment: string }) {
    const res = await fetch(`/api/documents/${documentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlightedText: payload.highlightedText ?? "", comment: payload.comment }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not add comment." };
    const c = data.comment as Comment;
    return {
      ok: true as const,
      item: {
        id: c.id,
        highlightedText: c.highlightedText,
        comment: c.comment,
        authorId: c.reviewerId,
        canDelete: true,
        canEdit: true,
        editedAt: c.editedAt,
      },
    };
  }

  async function onEdit(id: string, comment: string) {
    const res = await fetch(`/api/documents/${documentId}/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not edit comment." };
    const c = data.comment as Comment;
    return {
      ok: true as const,
      item: {
        id: c.id,
        highlightedText: c.highlightedText,
        comment: c.comment,
        authorId: c.reviewerId,
        canDelete: true,
        canEdit: true,
        editedAt: c.editedAt,
      },
    };
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/documents/${documentId}/comments/${id}`, { method: "DELETE" });
    return res.ok;
  }

  if (hasPdf) {
    return (
      <PdfHighlightViewer
        documentId={documentId}
        version={version}
        initialItems={initialItems}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        icon={MessageSquarePlus}
        heading="Inline Comments"
        description="Select any text on the document below to comment on a specific passage. Sent to the uploader along with your decision."
        collapsible
      />
    );
  }

  return (
    <HighlightCommentPanel
      text={extractedText}
      initialItems={initialItems}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      icon={MessageSquarePlus}
      heading="Inline Comments"
      description="Highlight any text below to comment on a specific passage. Sent to the uploader along with your decision."
      plainPlaceholder="Add a comment for the uploader..."
      collapsible
    />
  );
}
