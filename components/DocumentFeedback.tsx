"use client";

import { MessageCircle } from "lucide-react";
import HighlightCommentPanel, { type PanelItem } from "./HighlightCommentPanel";
import type { Role } from "@/lib/rbac";

type Feedback = {
  id: string;
  comment: string;
  userId: string;
  user: { name: string };
  editedAt?: string | null;
  status: "open" | "accepted" | "closed";
  responseNote: string | null;
  statusChangedBy: { name: string; role: Role } | null;
  taggedUser: { name: string; role: Role } | null;
};

/**
 * Open feedback from ANY authenticated user on a published document — not
 * tied to a review round like components/InlineCommentReview.tsx, and
 * deliberately a simple post-a-comment thread (same shape as a reviewer's
 * decision-time Comments box in ReviewActions.tsx) rather than the
 * highlight-a-passage UX InlineCommentReview uses — there's no document
 * text rendered here to select from at all. Only rendered at all when the
 * publishing manager opted this document into it (Document.feedbackEnabled
 * — decided at publish time, see ReviewActions.tsx), enforced again
 * server-side by app/api/documents/[id]/feedback/route.ts.
 *
 * Reuses HighlightCommentPanel's plain (no-highlightable-text) mode by
 * always passing it an empty `text` — that mode is already exactly this: an
 * input + Post button, and a flat list of add/edit/delete-able comments.
 */
export default function DocumentFeedback({
  documentId,
  myUserId,
  canModerate,
  feedbackEnabled,
  taggableUsers,
  initialFeedback,
}: {
  documentId: string;
  myUserId: string;
  // Manager/superadmin can remove OR edit anyone's feedback, not just
  // their own — see the DELETE/PATCH routes' own enforcement of the same
  // rule.
  canModerate: boolean;
  // Whether NEW feedback can still be posted right now — a manager or this
  // document's own uploader can turn this off any time from the Manage tab
  // (app/dashboard/documents/[id]/FeedbackManagement.tsx) without removing
  // what's already here, so this only hides the compose box, never the
  // existing list.
  feedbackEnabled: boolean;
  // Who this document's feedback can be directed at — its contributor, and
  // every reviewer it's ever had (see app/dashboard/documents/[id]/page.tsx's
  // own computation of this same set, and the POST route's matching
  // validation). Empty when nobody's reviewed it yet, which just hides the
  // tag picker.
  taggableUsers: { id: string; name: string; role: Role }[];
  initialFeedback: Feedback[];
}) {
  function toItem(f: Feedback): PanelItem {
    return {
      id: f.id,
      highlightedText: null,
      comment: f.comment,
      authorId: f.userId,
      authorLabel: f.userId === myUserId ? `${f.user.name} (you)` : f.user.name,
      canDelete: f.userId === myUserId || canModerate,
      // Editing someone else's wording, even as a manager, isn't offered —
      // see the PATCH route's own comment for why: unlike delete or a
      // status change, an edit has no visible attribution that it happened.
      canEdit: f.userId === myUserId,
      editedAt: f.editedAt,
      status: f.status === "open" ? undefined : f.status,
      responseNote: f.responseNote,
      statusChangedByName: f.statusChangedBy?.name ?? null,
      statusChangedByRole: f.statusChangedBy?.role ?? null,
      taggedUserName: f.taggedUser?.name ?? null,
    };
  }

  const initialItems: PanelItem[] = initialFeedback.map(toItem);

  async function onAdd(payload: { highlightedText: string | null; comment: string; taggedUserId?: string | null }) {
    const res = await fetch(`/api/documents/${documentId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlightedText: "", comment: payload.comment, taggedUserId: payload.taggedUserId ?? null }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not add feedback." };
    return { ok: true as const, item: toItem(data.feedback as Feedback) };
  }

  async function onEdit(id: string, comment: string) {
    const res = await fetch(`/api/documents/${documentId}/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not edit feedback." };
    return { ok: true as const, item: toItem(data.feedback as Feedback) };
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/documents/${documentId}/feedback/${id}`, { method: "DELETE" });
    return res.ok;
  }

  return (
    <HighlightCommentPanel
      text=""
      initialItems={initialItems}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      icon={MessageCircle}
      heading="Feedback"
      description={
        feedbackEnabled
          ? "Share your feedback on this document. Visible to everyone viewing it."
          : "New feedback is currently turned off for this document. Existing feedback is still shown below."
      }
      plainPlaceholder="Share your feedback on this document..."
      readOnly={!feedbackEnabled}
      taggableUsers={taggableUsers}
    />
  );
}
