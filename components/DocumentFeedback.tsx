"use client";

import { MessageCircle } from "lucide-react";
import HighlightCommentPanel, { type PanelItem, type ThreadReply } from "./HighlightCommentPanel";
import type { Role } from "@/lib/rbac";

type FeedbackReplyWire = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  comment: string;
  editedAt?: string | null;
  createdAt: string;
};

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
  // Follow-up messages after the first accept/close decision (responseNote
  // above) — see components/HighlightCommentPanel.tsx's own PanelItem.replies
  // for how these render. Accept/close/reply live here in the Feedback tab
  // now (moved off app/dashboard/documents/[id]/FeedbackManagement.tsx,
  // which now only has the on/off toggle).
  replies: FeedbackReplyWire[];
  // Ready-to-render Round.Attempt label ("v1.1") for whichever version was
  // live on the document when this feedback was posted, already resolved
  // server-side (see the feedback route) — null for feedback left before
  // this was tracked, or on a docType "link" document (no versions at all).
  versionLabel: string | null;
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
  canTriage,
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
  // Whether the VIEWER can accept/close/reply to feedback on this document
  // at all (a manager/superadmin, OR this document's own uploader even if
  // their role has none of the admin permissions) — the same canTriage rule
  // app/api/documents/[id]/feedback/[feedbackId]/route.ts enforces, passed
  // down as page.tsx's canManageFeedback. Per-item exclusion of the item's
  // own author (nobody triages their own feedback) happens below in toItem,
  // not here — this flag alone doesn't yet mean a given item is triageable.
  canTriage: boolean;
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
  // Editing someone else's reply, even as the manager/uploader who could
  // triage this feedback, isn't offered — same "no visible attribution"
  // reasoning as the main comment's own canEdit below.
  function toReplyItem(r: FeedbackReplyWire): ThreadReply {
    return {
      id: r.id,
      authorName: r.authorName,
      authorRole: r.authorRole,
      comment: r.comment,
      editedAt: r.editedAt,
      canEdit: r.authorId === myUserId,
    };
  }

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
      // Defensive: a route that forgets to include replies (as the POST
      // route once did) shouldn't crash the whole "your post succeeded"
      // response client-side — that exact bug meant a saved comment never
      // rendered at all, with no visible error, until a manual refresh.
      replies: (f.replies ?? []).map(toReplyItem),
      versionLabel: f.versionLabel,
      canTriage: canTriage && f.userId !== myUserId,
      isOwnFeedbackForATriager: canTriage && f.userId === myUserId,
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

  async function onSetStatus(id: string, status: "open" | "accepted" | "closed", responseNote: string | null) {
    const res = await fetch(`/api/documents/${documentId}/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, responseNote }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not update this feedback." };
    return { ok: true as const, item: toItem(data.feedback as Feedback) };
  }

  async function onSendReply(id: string, comment: string) {
    const res = await fetch(`/api/documents/${documentId}/feedback/${id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not send reply." };
    return { ok: true as const, reply: toReplyItem(data.reply as FeedbackReplyWire) };
  }

  async function onEditReply(itemId: string, replyId: string, comment: string) {
    const res = await fetch(`/api/documents/${documentId}/feedback/${itemId}/replies/${replyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false as const, error: data?.error ?? "Could not edit reply." };
    return { ok: true as const, reply: toReplyItem(data.reply as FeedbackReplyWire) };
  }

  return (
    <HighlightCommentPanel
      text=""
      initialItems={initialItems}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      onSetStatus={onSetStatus}
      onSendReply={onSendReply}
      onEditReply={onEditReply}
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
