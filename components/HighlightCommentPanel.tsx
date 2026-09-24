"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Pencil, X, ChevronDown, ChevronUp, AtSign, CheckCircle2, XCircle, RotateCcw, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

// A single entry in a feedback item's reply thread — see
// PanelItem.replies' own comment for what this covers and doesn't.
export type ThreadReply = {
  id: string;
  authorName: string;
  // Null only for the synthetic "decision" entry threadReplies() below
  // builds from an item's responseNote, when the role wasn't resolvable.
  authorRole: Role | null;
  comment: string;
  editedAt?: string | null;
  canEdit?: boolean;
};

export type PanelItem = {
  id: string;
  // null/empty = a general comment not tied to any specific passage — the
  // only kind possible when `text` itself is empty (see the component doc
  // comment below), but also allowed alongside highlighted ones once text
  // is present, for "overall" feedback that isn't about one specific spot.
  highlightedText: string | null;
  comment: string;
  authorId: string;
  // Shown next to the comment when this panel has more than one possible
  // author (e.g. open feedback from any user) — omitted by callers where
  // every item is always "my own" (e.g. a reviewer's own inline comments),
  // matching that surface's existing no-byline look.
  authorLabel?: string;
  canDelete: boolean;
  // Whether the CURRENT viewer can edit this item's text — usually the
  // same rule as canDelete (author, or a moderator for open feedback), but
  // kept as its own field rather than reusing canDelete so a caller could
  // diverge the two later without a type change.
  canEdit: boolean;
  // Set once this item has been edited at least once — shown as "(edited)"
  // so a viewer isn't misled into thinking the text is exactly what was
  // first written.
  editedAt?: string | null;
  // Feedback triage state (components/DocumentFeedback.tsx) — only ever set
  // by that caller; every other caller omits it and renders no badge, same
  // as before this existed. Absent/undefined means "open" (no badge shown
  // for that state, only for a real decision either way).
  status?: "accepted" | "closed";
  // The reply left alongside that status change (same source) — shown right
  // under the badge when present, so the person who left the feedback sees
  // why it was accepted/closed, not just that it was.
  responseNote?: string | null;
  // Who actually set `status` above — shown as "Accepted by X (Role)" next
  // to the badge. Only ever set alongside `status` by DocumentFeedback.tsx.
  statusChangedByName?: string | null;
  statusChangedByRole?: Role | null;
  // This item was directed at a specific person already involved with the
  // document (its contributor, or a reviewer) — see DocumentFeedback.tsx's
  // tag picker. Only ever set by that same caller.
  taggedUserName?: string | null;
  // Which document version was live when this was posted — a ready-to-
  // render label (e.g. "v3"), already formatted by the caller rather than a
  // raw number, same as taggedUserName above. Only DocumentFeedback.tsx sets
  // this; null when unknown (feedback from before this was tracked, or a
  // docType with no versions at all).
  versionLabel?: string | null;
  // Follow-up messages after the first accept/close decision (`responseNote`
  // above is the first one). Undefined (not just empty) right after adding/
  // editing an item in THIS session, since the add API response doesn't
  // include replies yet (a brand new item never has any) — always treated
  // the same as an empty list.
  replies?: ThreadReply[];
  // Whether the CURRENT viewer can accept/close/reply to THIS item — the
  // same canTriage rule the feedback API enforces (a manager/superadmin, or
  // this document's own uploader), already excluding the item's own author
  // (see DocumentFeedback.tsx's computation). Only DocumentFeedback.tsx ever
  // sets this or the two fields below; every other caller omits all three
  // and gets none of this UI.
  canTriage?: boolean;
  // True when the viewer generally CAN triage feedback on this document but
  // not THIS item specifically, because they're the one who wrote it — used
  // only to show a small explanatory note ("someone else needs to accept or
  // close it") instead of silently showing nothing.
  isOwnFeedbackForATriager?: boolean;
};

const STATUS_BADGE: Record<"accepted" | "closed", { label: string; className: string }> = {
  accepted: { label: "Accepted", className: "bg-ff-success/15 text-ff-success" },
  closed: { label: "Closed", className: "bg-ff-textMuted/15 text-ff-textMuted" },
};

// The first accept/close decision (`responseNote` + whoever set the status)
// and every follow-up (`replies`) are stored as separate fields, but read as
// one continuous conversation — rendering them with two different card
// styles (one with no author shown, one with) made it look like two
// unrelated features bolted together rather than a single thread. This
// folds both into one ordered list so every entry, first or later, renders
// identically.
function threadReplies(item: PanelItem): ThreadReply[] {
  // Not editable through this thread's own edit control — the decision
  // note is a different underlying field (DocumentFeedback.responseNote),
  // changed by re-triaging (Reopen, then decide again), not by editing text
  // in place.
  const first: ThreadReply[] = item.responseNote
    ? [
        {
          id: "decision",
          authorName: item.statusChangedByName ?? "Unknown",
          authorRole: item.statusChangedByRole ?? null,
          comment: item.responseNote,
          canEdit: false,
        },
      ]
    : [];
  return [...first, ...(item.replies ?? [])];
}

type Segment =
  | { type: "text"; content: string }
  | { type: "highlight"; content: string; itemId: string };

// Locates each item's highlightedText inside `text` and claims that
// character range so overlapping/duplicate substrings don't get
// double-highlighted, then walks the text once to produce an ordered list
// of plain-text and highlight segments to render. An item whose text can no
// longer be found (e.g. it only matched an already-claimed range, or it has
// no highlightedText at all) simply isn't highlighted inline — it still
// shows up in the list below.
function buildSegments(text: string, items: PanelItem[]): Segment[] {
  const claimedBy = new Array<string | null>(text.length).fill(null);

  for (const item of items) {
    const needle = item.highlightedText;
    if (!needle) continue;
    let fromIndex = 0;
    while (fromIndex <= text.length - needle.length) {
      const at = text.indexOf(needle, fromIndex);
      if (at === -1) break;
      let overlaps = false;
      for (let i = at; i < at + needle.length; i++) {
        if (claimedBy[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = at; i < at + needle.length; i++) claimedBy[i] = item.id;
        break;
      }
      fromIndex = at + 1;
    }
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const owner = claimedBy[i];
    let j = i;
    while (j < text.length && claimedBy[j] === owner) j++;
    const content = text.slice(i, j);
    segments.push(owner ? { type: "highlight", content, itemId: owner } : { type: "text", content });
    i = j;
  }
  return segments;
}

/**
 * Shared Google Docs-style "select text, attach a comment" UI, reused by
 * components/InlineCommentReview.tsx (a reviewer's own feedback during
 * their active review round) and components/DocumentFeedback.tsx (open
 * feedback from any user on a published document). Everything about who
 * can post, where it's persisted, and what happens on submit lives in the
 * caller — this component only owns the highlight/popover interaction and
 * local optimistic list state.
 *
 * When `text` is empty (a document with nothing extracted to highlight —
 * an external link, a video, or extraction just not being available) this
 * falls back to a plain comment box with no highlighting at all, so the
 * feature still works for every document type rather than silently
 * disappearing.
 */
export default function HighlightCommentPanel({
  text,
  initialItems,
  onAdd,
  onEdit,
  onDelete,
  onSetStatus,
  onSendReply,
  onEditReply,
  icon: Icon,
  heading,
  description,
  plainPlaceholder = "Add a comment...",
  readOnly = false,
  focusRequest,
  collapsible = false,
  taggableUsers,
  embedded = false,
}: {
  text: string;
  initialItems: PanelItem[];
  onAdd?: (payload: {
    highlightedText: string | null;
    comment: string;
    taggedUserId?: string | null;
  }) => Promise<{ ok: true; item: PanelItem } | { ok: false; error: string }>;
  onEdit?: (id: string, comment: string) => Promise<{ ok: true; item: PanelItem } | { ok: false; error: string }>;
  onDelete?: (id: string) => Promise<boolean>;
  // The first accept/close decision on an item (with its optional reply
  // note) — status is "open" to reopen an already-decided item back to
  // untriaged. Only DocumentFeedback.tsx passes this; every other caller
  // omits it, and no item of theirs ever has `canTriage: true` anyway.
  onSetStatus?: (
    id: string,
    status: "open" | "accepted" | "closed",
    responseNote: string | null
  ) => Promise<{ ok: true; item: PanelItem } | { ok: false; error: string }>;
  // A follow-up message after that first decision — see PanelItem.replies'
  // own comment for why this never touches status.
  onSendReply?: (id: string, comment: string) => Promise<{ ok: true; reply: ThreadReply } | { ok: false; error: string }>;
  // Editing the text of a reply already in the thread — the reply's own
  // author only (see ThreadReply.canEdit), same as onEdit above is for the
  // item's own comment. Takes both ids since a reply doesn't belong to the
  // panel's flat item list on its own.
  onEditReply?: (
    itemId: string,
    replyId: string,
    comment: string
  ) => Promise<{ ok: true; reply: ThreadReply } | { ok: false; error: string }>;
  icon: LucideIcon;
  heading: string;
  description: string;
  plainPlaceholder?: string;
  // Lets the plain (no-highlightable-text) compose box direct a new comment
  // at a specific person already involved with the document — only
  // DocumentFeedback.tsx passes this (its contributor + reviewers); omitted
  // everywhere else, which hides the picker entirely.
  taggableUsers?: { id: string; name: string; role: Role }[];
  // Pure viewing mode — no new-comment popover/input, no edit/delete (items
  // are expected to already carry canEdit/canDelete: false, but this also
  // suppresses the "select text to add a comment" interaction itself,
  // which per-item flags alone can't do). Used by
  // components/ReviewHighlightsViewer.tsx to let the uploader see where a
  // resolved round's comments landed on the actual document, read-only.
  readOnly?: boolean;
  // Externally trigger the same "jump to and flash this item" behavior
  // clicking a list row does — bump `nonce` on every request (even to the
  // same id) so a second click on an already-focused item still re-scrolls
  // and re-flashes it.
  focusRequest?: { id: string; nonce: number } | null;
  // Adds a collapse/expand toggle in the header — same opt-in as
  // components/PdfHighlightViewer.tsx's own `collapsible`, for a caller
  // whose page already has several large sections stacked (see
  // components/InlineCommentReview.tsx). Off by default.
  collapsible?: boolean;
  // Drops this panel's own card chrome (border/shadow/margin) — for a
  // caller that already renders it inside another bordered card (see
  // components/ReviewHighlightsViewer.tsx, nested inside app/dashboard/
  // documents/[id]/ReviewTrail.tsx's "Document Comments" card), where the
  // full card-in-a-card-in-a-card look was the actual complaint this was
  // added for. Off by default — every other caller renders this as its own
  // standalone top-level section and still wants the card.
  embedded?: boolean;
}) {
  const [items, setItems] = useState<PanelItem[]>(initialItems);
  // Set once someone's actually picked from the @mention dropdown below —
  // this id is what's sent as taggedUserId, never re-derived from the "@Name"
  // text itself (two taggable people could share a name). Cleared if that
  // mention text gets edited/deleted out of the draft before posting — see
  // the check in submitPlain.
  const [tagDraft, setTagDraft] = useState("");
  // Non-null while the text right before the cursor looks like "@partial" —
  // holds that partial query, used to filter taggableUsers below. Plain
  // <input> has no rich-text mention rendering, so the "@Name" stays as
  // literal text in the draft once picked; this state only drives the
  // suggestion popup, not anything persisted.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const plainInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Same floating "collapse" pill as app/dashboard/documents/[id]/
  // ReviewTrailWithHighlights.tsx's Reviewer Highlights panel and this
  // component's PDF counterpart (components/PdfHighlightViewer.tsx) — see
  // either's own comment for why it only shows during active scrolling.
  const [showFloatingCollapse, setShowFloatingCollapse] = useState(false);
  const hideFloatingCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!collapsible || collapsed) return;
    function onWindowScroll() {
      setShowFloatingCollapse(true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
      hideFloatingCollapseTimer.current = setTimeout(() => setShowFloatingCollapse(false), 1000);
    }
    document.addEventListener("scroll", onWindowScroll, true);
    return () => {
      document.removeEventListener("scroll", onWindowScroll, true);
      if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
    };
  }, [collapsible, collapsed]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ text: string; top: number; left: number } | null>(
    null
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Triage (accept/close/reopen + follow-up replies) — keyed by item id
  // since more than one item's controls can be visible on screen at once,
  // unlike editingItemId above (only one item is ever mid-edit).
  const [statusNoteDrafts, setStatusNoteDrafts] = useState<Record<string, string>>({});
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusyId, setReplyBusyId] = useState<string | null>(null);
  const [triageError, setTriageError] = useState<Record<string, string | null>>({});
  // Editing a reply already in the thread — a global "which one" (not keyed
  // by item id) since only one reply can ever be mid-edit at a time, same as
  // editingItemId above for the item's own comment.
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyDraft, setEditReplyDraft] = useState("");
  const [editReplySubmitting, setEditReplySubmitting] = useState(false);
  const [editReplyError, setEditReplyError] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const markRefs = useRef<Record<string, HTMLElement | null>>({});
  // jumpToItem's own scrollIntoView fires scroll events on textRef while it
  // animates — without this guard, the scroll-close handler below would
  // immediately close the very popover jumpToItem just opened.
  const suppressScrollCloseRef = useRef(false);
  // Bumped on every textRef scroll event purely to force a re-render, so
  // activeMarkRect (computed fresh below on each render) keeps tracking the
  // mark's on-screen position live while jumpToItem's scroll is animating —
  // without this the popover would stay put at its pre-scroll position and
  // only snap to the right place once some unrelated re-render happened to
  // occur (e.g. the flash-ring timeout firing well after the scroll ended).
  const [, bumpScrollTick] = useState(0);

  const hasText = text.trim().length > 0;
  const segments = useMemo(() => (hasText ? buildSegments(text, items) : []), [hasText, text, items]);
  const activeItem = items.find((c) => c.id === activeItemId) ?? null;
  const activeMarkRect =
    activeItemId && markRefs.current[activeItemId] ? markRefs.current[activeItemId]!.getBoundingClientRect() : null;

  function closePopovers() {
    setPendingSelection(null);
    setActiveItemId(null);
    setDraft("");
    setError(null);
    cancelEdit();
  }

  function startEdit(item: PanelItem) {
    setEditingItemId(item.id);
    setEditDraft(item.comment);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingItemId(null);
    setEditDraft("");
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim() || !onEdit) return;
    setEditSubmitting(true);
    setEditError(null);
    const res = await onEdit(id, editDraft.trim());
    setEditSubmitting(false);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? res.item : it)));
    cancelEdit();
  }

  function handleMouseUp() {
    if (!hasText || readOnly) return;
    const selection = window.getSelection();
    const selected = selection?.toString().trim() ?? "";
    // Ignore selections made outside the text panel (e.g. selecting other
    // page content) — only text actually inside textRef counts.
    if (!selected || !textRef.current || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    setActiveItemId(null);
    setPendingSelection({ text: selected, top: rect.top, left: rect.left + rect.width / 2 });
    setDraft("");
    setError(null);
  }

  async function submitHighlighted() {
    if (!pendingSelection || !draft.trim() || !onAdd) return;
    setSubmitting(true);
    setError(null);
    const res = await onAdd({ highlightedText: pendingSelection.text, comment: draft.trim() });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setItems((prev) => [...prev, res.item]);
    setPendingSelection(null);
    setDraft("");
    window.getSelection()?.removeAllRanges();
  }

  // Finds the "@partial" segment ending right at the cursor, if any —
  // requires whitespace (or start-of-text) right before the "@" so an email
  // address or a mid-word "@" never triggers it.
  function findMentionMatch(value: string, cursorPos: number) {
    const uptoCursor = value.slice(0, cursorPos);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(uptoCursor);
    if (!match) return null;
    return { query: match[1], start: uptoCursor.length - match[1].length - 1 };
  }

  function onPlainDraftChange(value: string, cursorPos: number) {
    setDraft(value);
    const match = findMentionMatch(value, cursorPos);
    setMentionQuery(match?.query ?? null);
    setMentionHighlight(0);
  }

  const mentionMatches =
    mentionQuery !== null && taggableUsers
      ? taggableUsers.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
      : [];

  function pickMention(u: { id: string; name: string; role: Role }) {
    const input = plainInputRef.current;
    const cursorPos = input?.selectionStart ?? draft.length;
    const match = findMentionMatch(draft, cursorPos);
    if (!match) return;
    const before = draft.slice(0, match.start);
    const after = draft.slice(cursorPos);
    const inserted = `@${u.name} `;
    const newDraft = `${before}${inserted}${after}`;
    setDraft(newDraft);
    setTagDraft(u.id);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      input?.setSelectionRange(pos, pos);
      input?.focus();
    });
  }

  async function submitPlain() {
    if (!draft.trim() || !onAdd) return;
    setSubmitting(true);
    setError(null);
    // The visible "@Name" is the only record of the tag once typed — if
    // that text got edited or deleted after picking it, the id shouldn't
    // silently survive pointing at a mention that's no longer actually in
    // the comment.
    const taggedUser = taggableUsers?.find((u) => u.id === tagDraft);
    const stillMentioned = taggedUser ? draft.includes(`@${taggedUser.name}`) : false;
    const res = await onAdd({
      highlightedText: null,
      comment: draft.trim(),
      taggedUserId: stillMentioned ? tagDraft : null,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setItems((prev) => [...prev, res.item]);
    setDraft("");
    setTagDraft("");
    setMentionQuery(null);
  }

  async function removeItem(id: string) {
    if (!onDelete) return;
    const ok = await onDelete(id);
    if (ok) {
      setItems((prev) => prev.filter((c) => c.id !== id));
      setActiveItemId(null);
      if (editingItemId === id) cancelEdit();
    }
  }

  async function setItemStatus(id: string, status: "open" | "accepted" | "closed") {
    if (!onSetStatus) return;
    setStatusBusyId(id);
    setTriageError((prev) => ({ ...prev, [id]: null }));
    const responseNote = statusNoteDrafts[id]?.trim() || null;
    const res = await onSetStatus(id, status, responseNote);
    setStatusBusyId(null);
    if (!res.ok) {
      setTriageError((prev) => ({ ...prev, [id]: res.error }));
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? res.item : it)));
  }

  async function sendItemReply(id: string) {
    if (!onSendReply) return;
    const comment = (replyDrafts[id] ?? "").trim();
    if (!comment) return;
    setReplyBusyId(id);
    setTriageError((prev) => ({ ...prev, [id]: null }));
    const res = await onSendReply(id, comment);
    setReplyBusyId(null);
    if (!res.ok) {
      setTriageError((prev) => ({ ...prev, [id]: res.error }));
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, replies: [...(it.replies ?? []), res.reply] } : it))
    );
    setReplyDrafts((prev) => ({ ...prev, [id]: "" }));
  }

  function startEditReply(replyId: string, currentComment: string) {
    setEditingReplyId(replyId);
    setEditReplyDraft(currentComment);
    setEditReplyError(null);
  }

  function cancelEditReply() {
    setEditingReplyId(null);
    setEditReplyDraft("");
    setEditReplyError(null);
  }

  async function saveReplyEdit(itemId: string, replyId: string) {
    if (!onEditReply || !editReplyDraft.trim()) return;
    setEditReplySubmitting(true);
    setEditReplyError(null);
    const res = await onEditReply(itemId, replyId, editReplyDraft.trim());
    setEditReplySubmitting(false);
    if (!res.ok) {
      setEditReplyError(res.error);
      return;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, replies: (it.replies ?? []).map((r) => (r.id === replyId ? res.reply : r)) } : it
      )
    );
    cancelEditReply();
  }

  function jumpToItem(id: string) {
    const el = markRefs.current[id];
    if (el) {
      suppressScrollCloseRef.current = true;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlashedId(id);
      setTimeout(() => setFlashedId((cur) => (cur === id ? null : cur)), 1200);
      // No native "scroll finished" callback for scrollIntoView, so this is
      // a generous fixed delay rather than an exact signal — long enough to
      // outlast the smooth-scroll animation in practice.
      setTimeout(() => {
        suppressScrollCloseRef.current = false;
      }, 700);
    }
    setPendingSelection(null);
    setActiveItemId(id);
  }

  // Popovers are viewport-anchored (getBoundingClientRect coordinates), so
  // scrolling the text panel would leave them pointing at stale positions —
  // simplest fix is to just close them on scroll rather than track it. But
  // jumpToItem's own scrollIntoView above also fires this same scroll event
  // while it's animating, so it's suppressed during that window — otherwise
  // the popover jumpToItem just opened would close itself a moment later.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const onScroll = () => {
      if (suppressScrollCloseRef.current) {
        bumpScrollTick((n) => n + 1);
        return;
      }
      closePopovers();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Clicking anywhere outside the text panel and outside a popover itself
  // dismisses it — matches Google Docs' click-away-to-close comment cards.
  useEffect(() => {
    if (!hasText) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (textRef.current?.contains(target)) return;
      if (target.closest(".hcp-popover")) return;
      closePopovers();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [hasText]);

  // An external caller (components/ReviewHighlightsViewer.tsx, driven by a
  // click on a comment row in ReviewTrail.tsx) asking this panel to jump to
  // and flash a specific item, same as clicking it directly below would.
  useEffect(() => {
    if (!focusRequest) return;
    jumpToItem(focusRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.id, focusRequest?.nonce]);

  return (
    <>
    <section className={embedded ? "" : "mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff"}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-bold text-ff-text">
          <Icon className="h-4 w-4" aria-hidden />
          {heading}
        </h2>
        {collapsible && (
          <button
            type="button"
            onClick={() => {
              closePopovers();
              setCollapsed((c) => !c);
            }}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* CSS-hidden, not unmounted, while collapsed — textRef/markRefs stay
          attached so scroll/click-away listeners and the highlight segments
          don't need to be torn down and rebuilt on every re-expand. */}
      <div className={collapsed ? "hidden" : ""}>
      <p className="mb-3 text-xs text-ff-textMuted">{description}</p>

      {hasText ? (
        <div
          ref={textRef}
          onMouseUp={handleMouseUp}
          className="mb-3 max-h-64 select-text overflow-auto whitespace-pre-wrap rounded-ff border border-ff-border bg-ff-lavender/30 p-3 text-sm text-ff-text"
        >
          {segments.map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.content}</span>
            ) : (
              <mark
                key={i}
                ref={(el) => {
                  markRefs.current[seg.itemId] = el;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingSelection(null);
                  setActiveItemId(seg.itemId);
                }}
                className={`cursor-pointer rounded-sm bg-[#00994D]/40 transition-all hover:bg-[#00994D]/55 hover:shadow-[0_0_6px_rgba(0,153,77,0.6)] ${
                  flashedId === seg.itemId ? "ring-2 ring-ff-accent" : ""
                } ${
                  activeItemId === seg.itemId ? "bg-[#00994D]/55 shadow-[0_0_6px_rgba(0,153,77,0.6)]" : ""
                }`}
              >
                {seg.content}
              </mark>
            )
          )}
        </div>
      ) : readOnly ? null : (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                ref={plainInputRef}
                value={draft}
                onChange={(e) => onPlainDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onKeyDown={(e) => {
                  if (mentionMatches.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionHighlight((i) => (i + 1) % mentionMatches.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionHighlight((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(mentionMatches[mentionHighlight]);
                      return;
                    }
                    if (e.key === "Escape") {
                      setMentionQuery(null);
                      return;
                    }
                  }
                  if (e.key === "Enter") submitPlain();
                }}
                onBlur={() => {
                  // Delayed so a click on a suggestion (which blurs the
                  // input first) still registers before the list unmounts.
                  setTimeout(() => setMentionQuery(null), 150);
                }}
                placeholder={taggableUsers && taggableUsers.length > 0 ? `${plainPlaceholder} Type @ to tag someone.` : plainPlaceholder}
                className="min-w-0 w-full rounded-ff border border-ff-border px-3 py-1.5 text-sm"
              />
              {mentionQuery !== null && mentionMatches.length > 0 && (
                <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-ff border border-ff-border bg-white py-1 shadow-ff-md">
                  {mentionMatches.map((u, i) => (
                    <button
                      key={u.id}
                      type="button"
                      // Mousedown (not click) fires before the input's own
                      // onBlur, so the pick always lands even though this
                      // button isn't focusable in the normal tab order.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(u);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                        i === mentionHighlight ? "bg-ff-lavender/60" : "hover:bg-ff-lavender/40"
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ff-accent/15 text-[10px] font-semibold text-ff-accent">
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ff-text">{u.name}</span>
                      <span className="shrink-0 text-xs text-ff-textMuted">{ROLE_LABELS[u.role]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={submitPlain}
              disabled={submitting || !draft.trim()}
              className="shrink-0 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
            >
              Post
            </button>
          </div>
        </div>
      )}

      {hasText && pendingSelection && (
        <div
          className="hcp-popover fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-ff border border-ff-border bg-white p-3 shadow-ff-md"
          style={{ top: pendingSelection.top - 10, left: pendingSelection.left }}
        >
          <p className="mb-2 truncate text-xs text-ff-textMuted">
            &ldquo;<span className="italic text-ff-text">{pendingSelection.text}</span>&rdquo;
          </p>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitHighlighted();
              if (e.key === "Escape") closePopovers();
            }}
            placeholder="Add a comment..."
            className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm"
          />
          {error && <p className="mb-2 text-xs text-ff-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitHighlighted}
              disabled={submitting || !draft.trim()}
              className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
            >
              Comment
            </button>
            <button
              type="button"
              onClick={closePopovers}
              className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {hasText && activeItem && activeMarkRect && (
        <div
          className="hcp-popover fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-ff border border-ff-border bg-white p-3 pr-7 shadow-ff-md"
          style={{ top: activeMarkRect.top - 10, left: activeMarkRect.left + activeMarkRect.width / 2 }}
        >
          <button
            type="button"
            onClick={closePopovers}
            title="Close"
            aria-label="Close"
            className="absolute right-1.5 top-1.5 rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          {activeItem.authorLabel && (
            <p className="mb-1 text-xs font-medium text-ff-textMuted">{activeItem.authorLabel}</p>
          )}
          {editingItemId === activeItem.id ? (
            <>
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(activeItem.id);
                  if (e.key === "Escape") cancelEdit();
                }}
                className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm"
              />
              {editError && <p className="mb-2 text-xs text-ff-danger">{editError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveEdit(activeItem.id)}
                  disabled={editSubmitting || !editDraft.trim()}
                  className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm text-ff-text">
                {activeItem.comment}
                {activeItem.editedAt && <span className="ml-1 text-xs italic text-ff-textMuted">(edited)</span>}
              </p>
              {(activeItem.canEdit || activeItem.canDelete) && (
                <div className="flex items-center gap-2 border-t border-ff-border pt-2">
                  {activeItem.canEdit && (
                    <button
                      type="button"
                      onClick={() => startEdit(activeItem)}
                      className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </button>
                  )}
                  {activeItem.canDelete && (
                    <button
                      type="button"
                      onClick={() => removeItem(activeItem.id)}
                      className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-danger transition-colors hover:bg-ff-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!hasText && error && <p className="mb-3 text-xs text-ff-danger">{error}</p>}

      {items.length > 0 && (
        <ul className={hasText ? "space-y-1.5 border-t border-ff-border pt-3" : "space-y-2"}>
          {items.map((item) =>
            hasText ? (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => jumpToItem(item.id)}
                  className="w-full rounded-ff border border-ff-border p-2.5 text-left text-sm transition-colors hover:bg-ff-lavender/30"
                >
                  {item.authorLabel && (
                    <p className="mb-0.5 text-xs font-medium text-ff-textMuted">{item.authorLabel}</p>
                  )}
                  {item.highlightedText && (
                    <p className="mb-0.5 truncate text-xs italic text-ff-textMuted">
                      &ldquo;{item.highlightedText}&rdquo;
                    </p>
                  )}
                  <p className="text-ff-text">
                    {item.comment}
                    {item.editedAt && <span className="ml-1 text-xs italic text-ff-textMuted">(edited)</span>}
                  </p>
                </button>
              </li>
            ) : (
              <li key={item.id} className="rounded-ff border border-ff-border bg-white p-3 shadow-sm">
                {editingItemId === item.id ? (
                  <div>
                    <input
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(item.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm"
                    />
                    {editError && <p className="mb-2 text-xs text-ff-danger">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(item.id)}
                        disabled={editSubmitting || !editDraft.trim()}
                        className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5">
                    {item.authorLabel && (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ff-accent/15 text-xs font-semibold text-ff-accent">
                        {item.authorLabel.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {(item.authorLabel || item.status || item.taggedUserName || item.versionLabel) && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          {item.authorLabel && (
                            <span className="text-xs font-semibold text-ff-text">{item.authorLabel}</span>
                          )}
                          {item.versionLabel && (
                            <span
                              title={`Given on ${item.versionLabel}`}
                              className="rounded-full bg-ff-lavender px-1.5 py-0.5 text-[10px] font-medium text-ff-textMuted"
                            >
                              {item.versionLabel}
                            </span>
                          )}
                          {item.taggedUserName && (
                            <span
                              title={`Directed at ${item.taggedUserName}`}
                              className="inline-flex items-center gap-0.5 rounded-full bg-ff-lavender px-1.5 py-0.5 text-[10px] font-medium text-ff-accent"
                            >
                              <AtSign className="h-2.5 w-2.5" aria-hidden />
                              {item.taggedUserName}
                            </span>
                          )}
                          {item.status && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[item.status].className}`}>
                              {STATUS_BADGE[item.status].label}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-sm text-ff-text">
                        {item.comment}
                        {item.editedAt && <span className="ml-1 text-xs italic text-ff-textMuted">(edited)</span>}
                      </p>
                      {item.status && !item.responseNote && item.statusChangedByName && (
                        // No note was left with the decision — nothing to
                        // show in the thread below, so this is the only
                        // record of who decided and when.
                        <p className="mt-1 text-[11px] text-ff-textMuted">
                          {STATUS_BADGE[item.status].label} by {item.statusChangedByName}
                          {item.statusChangedByRole && ` (${ROLE_LABELS[item.statusChangedByRole]})`}
                        </p>
                      )}
                      {threadReplies(item).length > 0 && (
                        <ul className="mt-1.5 space-y-1.5 border-l-2 border-ff-accent/30 pl-2.5">
                          {threadReplies(item).map((r) =>
                            editingReplyId === r.id ? (
                              <li key={r.id} className="rounded-ff border border-ff-border bg-white p-2">
                                <input
                                  autoFocus
                                  value={editReplyDraft}
                                  onChange={(e) => setEditReplyDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveReplyEdit(item.id, r.id);
                                    if (e.key === "Escape") cancelEditReply();
                                  }}
                                  className="mb-1.5 w-full rounded-ff border border-ff-border px-2 py-1 text-xs"
                                />
                                {editReplyError && <p className="mb-1.5 text-[11px] text-ff-danger">{editReplyError}</p>}
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => saveReplyEdit(item.id, r.id)}
                                    disabled={editReplySubmitting || !editReplyDraft.trim()}
                                    className="rounded-ff bg-ff-accent-gradient px-2 py-1 text-[11px] font-medium text-white shadow-ff disabled:opacity-60"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditReply}
                                    className="rounded-ff border border-ff-border px-2 py-1 text-[11px] text-ff-text hover:bg-ff-lavender/40"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </li>
                            ) : (
                              <li
                                key={r.id}
                                className="group flex items-start justify-between gap-1.5 rounded-ff bg-ff-lavender/40 px-2.5 py-1.5 text-xs text-ff-text"
                              >
                                <span>
                                  <span className="font-semibold">{r.authorName}</span>
                                  {r.authorRole && <span className="text-ff-textMuted"> ({ROLE_LABELS[r.authorRole]})</span>}
                                  {": "}
                                  {r.comment}
                                  {r.editedAt && <span className="ml-1 text-[10px] italic text-ff-textMuted">(edited)</span>}
                                </span>
                                {r.canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => startEditReply(r.id, r.comment)}
                                    title="Edit reply"
                                    aria-label="Edit reply"
                                    className="shrink-0 rounded p-0.5 text-ff-textMuted opacity-0 transition-opacity hover:text-ff-accent group-hover:opacity-100"
                                  >
                                    <Pencil className="h-3 w-3" aria-hidden />
                                  </button>
                                )}
                              </li>
                            )
                          )}
                        </ul>
                      )}

                      {item.isOwnFeedbackForATriager && (
                        <p className="mt-2 text-xs italic text-ff-textMuted">
                          This is your own feedback. Someone else needs to accept or close it.
                        </p>
                      )}

                      {item.canTriage && !item.status && (
                        // First decision — the one action this feedback's
                        // author is actually waiting on, so it's the only
                        // reply here that requires picking Accept or Close.
                        <div className="mt-2">
                          <input
                            value={statusNoteDrafts[item.id] ?? ""}
                            onChange={(e) => setStatusNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Add a reply note (optional), sent with your decision"
                            disabled={statusBusyId === item.id}
                            className="mb-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-xs disabled:opacity-60"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setItemStatus(item.id, "accepted")}
                              disabled={statusBusyId === item.id}
                              className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:border-ff-success/40 hover:bg-ff-success/10 hover:text-ff-success disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => setItemStatus(item.id, "closed")}
                              disabled={statusBusyId === item.id}
                              className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
                            >
                              <XCircle className="h-3.5 w-3.5" aria-hidden />
                              Close
                            </button>
                          </div>
                        </div>
                      )}

                      {item.canTriage && item.status && (
                        // Already decided once — every reply from here on is
                        // just conversation: one input, one send icon,
                        // posted instantly with no status picker to wait on.
                        // Reopen (a real status change) stays available as
                        // its own small action below, not mixed into sending
                        // a reply. Closed is treated as done, not just
                        // another ongoing state — the thread stays readable
                        // but no new reply can be sent until it's reopened.
                        <div className="mt-2">
                          {item.status === "accepted" ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={replyDrafts[item.id] ?? ""}
                                onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && sendItemReply(item.id)}
                                placeholder="Send another reply..."
                                disabled={replyBusyId === item.id}
                                className="min-w-0 flex-1 rounded-ff border border-ff-border px-2.5 py-1.5 text-xs disabled:opacity-60"
                              />
                              <button
                                type="button"
                                onClick={() => sendItemReply(item.id)}
                                disabled={replyBusyId === item.id || !(replyDrafts[item.id] ?? "").trim()}
                                title="Send reply"
                                aria-label="Send reply"
                                className="shrink-0 rounded-ff bg-ff-accent-gradient p-1.5 text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                              >
                                <Send className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] italic text-ff-textMuted">
                              This feedback is closed. Reopen it to send another reply.
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => setItemStatus(item.id, "open")}
                            disabled={statusBusyId === item.id}
                            className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ff-textMuted transition-colors hover:text-ff-text disabled:opacity-60"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden />
                            Reopen
                          </button>
                        </div>
                      )}

                      {triageError[item.id] && (
                        <p className="mt-1.5 text-xs text-ff-danger">{triageError[item.id]}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.canEdit && (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          title="Edit comment"
                          aria-label="Edit comment"
                          className="rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {item.canDelete && (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          title="Delete comment"
                          aria-label="Delete comment"
                          className="rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      )}
      </div>
    </section>

    {collapsible && !collapsed && (
      <button
        type="button"
        onClick={() => {
          closePopovers();
          setCollapsed(true);
        }}
        onMouseEnter={() => {
          if (hideFloatingCollapseTimer.current) clearTimeout(hideFloatingCollapseTimer.current);
          setShowFloatingCollapse(true);
        }}
        onMouseLeave={() => {
          hideFloatingCollapseTimer.current = setTimeout(() => setShowFloatingCollapse(false), 1000);
        }}
        aria-hidden={!showFloatingCollapse}
        tabIndex={showFloatingCollapse ? 0 : -1}
        className={`fixed bottom-5 right-5 z-30 flex items-center gap-1.5 rounded-full bg-ff-accent-gradient px-4 py-2.5 text-xs font-semibold text-white shadow-ff-lg transition-opacity duration-300 hover:brightness-105 ${
          showFloatingCollapse ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        Collapse {heading}
      </button>
    )}
    </>
  );
}
