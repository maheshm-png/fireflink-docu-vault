"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Pencil, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
};

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
  icon: Icon,
  heading,
  description,
  plainPlaceholder = "Add a comment...",
  readOnly = false,
  focusRequest,
}: {
  text: string;
  initialItems: PanelItem[];
  onAdd?: (payload: {
    highlightedText: string | null;
    comment: string;
  }) => Promise<{ ok: true; item: PanelItem } | { ok: false; error: string }>;
  onEdit?: (id: string, comment: string) => Promise<{ ok: true; item: PanelItem } | { ok: false; error: string }>;
  onDelete?: (id: string) => Promise<boolean>;
  icon: LucideIcon;
  heading: string;
  description: string;
  plainPlaceholder?: string;
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
}) {
  const [items, setItems] = useState<PanelItem[]>(initialItems);
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
  const textRef = useRef<HTMLDivElement>(null);
  const markRefs = useRef<Record<string, HTMLElement | null>>({});

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

  async function submitPlain() {
    if (!draft.trim() || !onAdd) return;
    setSubmitting(true);
    setError(null);
    const res = await onAdd({ highlightedText: null, comment: draft.trim() });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setItems((prev) => [...prev, res.item]);
    setDraft("");
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

  function jumpToItem(id: string) {
    const el = markRefs.current[id];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlashedId(id);
      setTimeout(() => setFlashedId((cur) => (cur === id ? null : cur)), 1200);
    }
    setPendingSelection(null);
    setActiveItemId(id);
  }

  // Popovers are viewport-anchored (getBoundingClientRect coordinates), so
  // scrolling the text panel would leave them pointing at stale positions —
  // simplest fix is to just close them on scroll rather than track it.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const onScroll = () => closePopovers();
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
    <section className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-1 flex items-center gap-1.5 text-base font-bold text-ff-text">
        <Icon className="h-4 w-4" aria-hidden />
        {heading}
      </h2>
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
                className={`cursor-pointer rounded-sm bg-amber-200/35 transition-colors hover:bg-amber-300/45 ${
                  flashedId === seg.itemId ? "ring-2 ring-ff-accent" : ""
                } ${activeItemId === seg.itemId ? "bg-amber-300/45" : ""}`}
              >
                {seg.content}
              </mark>
            )
          )}
        </div>
      ) : readOnly ? null : (
        <div className="mb-3 flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPlain()}
            placeholder={plainPlaceholder}
            className="min-w-0 flex-1 rounded-ff border border-ff-border px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={submitPlain}
            disabled={submitting || !draft.trim()}
            className="shrink-0 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
          >
            Post
          </button>
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
              <li key={item.id} className="rounded-ff border border-ff-border p-2.5 text-sm">
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
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {item.authorLabel && (
                        <p className="mb-0.5 text-xs font-medium text-ff-textMuted">{item.authorLabel}</p>
                      )}
                      <p className="text-ff-text">
                        {item.comment}
                        {item.editedAt && <span className="ml-1 text-xs italic text-ff-textMuted">(edited)</span>}
                      </p>
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
    </section>
  );
}
