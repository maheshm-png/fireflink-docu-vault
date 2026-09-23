"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, CheckCircle2, XCircle, RotateCcw, AtSign } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

type FeedbackItem = {
  id: string;
  authorId: string;
  comment: string;
  authorName: string;
  status: "open" | "accepted" | "closed";
  responseNote: string | null;
  // Who actually set `status` above, and their role — "Accepted by X
  // (Manager)". Null while status is still "open".
  statusChangedByName: string | null;
  statusChangedByRole: Role | null;
  // This item was directed at a specific person (the document's
  // contributor, or a reviewer) — see components/DocumentFeedback.tsx's tag
  // picker.
  taggedUserName: string | null;
};

const STATUS_LABEL: Record<FeedbackItem["status"], string> = {
  open: "Open",
  accepted: "Accepted",
  closed: "Closed",
};

const STATUS_CLASS: Record<FeedbackItem["status"], string> = {
  open: "bg-ff-warning/15 text-ff-warning",
  accepted: "bg-ff-success/15 text-ff-success",
  closed: "bg-ff-textMuted/15 text-ff-textMuted",
};

// Manage-tab feedback controls — a manager or this document's own uploader
// can turn new feedback collection on/off at any time (not just the
// one-time choice at approval, see ReviewActions.tsx) and triage existing
// items as Accepted/Closed without deleting them, with an optional reply
// note explaining the decision (see the feedback/[feedbackId] PATCH route's
// status + responseNote handling). Both the triage badge and the note show
// everywhere the feedback itself does (components/DocumentFeedback.tsx),
// not just here. Accepting also notifies the feedback's own author
// (lib/notify.ts's notifyFeedbackAccepted).
export default function FeedbackManagement({
  documentId,
  myUserId,
  initialFeedbackEnabled,
  items,
}: {
  documentId: string;
  // Whoever left a piece of feedback can't also be the one who accepts or
  // closes it (enforced server-side too, see the feedback/[feedbackId]
  // PATCH route) — used here just to hide the buttons on your own items
  // instead of letting you click them into a 403.
  myUserId: string;
  initialFeedbackEnabled: boolean;
  items: FeedbackItem[];
}) {
  const router = useRouter();
  const [feedbackEnabled, setFeedbackEnabled] = useState(initialFeedbackEnabled);
  const [busyToggle, setBusyToggle] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, FeedbackItem["status"]>>(
    Object.fromEntries(items.map((it) => [it.id, it.status]))
  );
  const [savedNotes, setSavedNotes] = useState<Record<string, string | null>>(
    Object.fromEntries(items.map((it) => [it.id, it.responseNote]))
  );
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(
    Object.fromEntries(items.map((it) => [it.id, it.responseNote ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);

  async function toggleFeedback() {
    setBusyToggle(true);
    setError(null);
    const next = !feedbackEnabled;
    const res = await fetch(`/api/documents/${documentId}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackEnabled: next }),
    });
    setBusyToggle(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this setting, please try again.");
      return;
    }
    setFeedbackEnabled(next);
    router.refresh();
  }

  async function setStatus(id: string, status: FeedbackItem["status"]) {
    setBusyItemId(id);
    setError(null);
    const responseNote = noteDrafts[id]?.trim() || null;
    const res = await fetch(`/api/documents/${documentId}/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, responseNote }),
    });
    setBusyItemId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this feedback, please try again.");
      return;
    }
    setStatuses((prev) => ({ ...prev, [id]: status }));
    setSavedNotes((prev) => ({ ...prev, [id]: responseNote }));
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-ff ${
              feedbackEnabled ? "bg-ff-success/10 text-ff-success" : "bg-ff-lavender text-ff-textMuted"
            }`}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ff-text">Accept New Feedback</p>
            <p className="text-xs text-ff-textMuted">
              Lets anyone viewing this document leave feedback. Turn off to stop taking new comments without
              removing what&apos;s already there.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={feedbackEnabled}
          aria-label={feedbackEnabled ? "Turn off new feedback" : "Turn on new feedback"}
          onClick={toggleFeedback}
          disabled={busyToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            feedbackEnabled ? "bg-ff-success" : "bg-ff-border"
          }`}
        >
          {busyToggle ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <BrandedLoader size={12} variant="white" />
            </span>
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                feedbackEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          )}
        </button>
      </div>

      {items.length > 0 && (
        <div className="px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-ff-text">Feedback Items</p>
          <ul className="space-y-2.5">
            {items.map((it) => {
              const status = statuses[it.id] ?? it.status;
              const savedNote = savedNotes[it.id] ?? it.responseNote;
              const busy = busyItemId === it.id;
              const isOwnFeedback = it.authorId === myUserId;
              return (
                <li key={it.id} className="rounded-ff border border-ff-border bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ff-accent/15 text-xs font-semibold text-ff-accent">
                      {it.authorName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-ff-text">{it.authorName}</span>
                        {it.taggedUserName && (
                          <span
                            title={`Directed at ${it.taggedUserName}`}
                            className="inline-flex items-center gap-0.5 rounded-full bg-ff-lavender px-1.5 py-0.5 text-[10px] font-medium text-ff-accent"
                          >
                            <AtSign className="h-2.5 w-2.5" aria-hidden />
                            {it.taggedUserName}
                          </span>
                        )}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[status]}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </div>
                      <p className="text-sm text-ff-text">{it.comment}</p>
                      {savedNote && (
                        <p className="mt-1.5 rounded-ff border-l-[3px] border-l-ff-accent bg-ff-lavender/40 px-2.5 py-1.5 text-xs text-ff-text">
                          {savedNote}
                        </p>
                      )}
                      {status !== "open" && it.statusChangedByName && (
                        <p className="mt-1 text-[11px] text-ff-textMuted">
                          {STATUS_LABEL[status]} by {it.statusChangedByName}
                          {it.statusChangedByRole && ` (${ROLE_LABELS[it.statusChangedByRole]})`}
                        </p>
                      )}

                      {isOwnFeedback ? (
                        <p className="mt-2 text-xs italic text-ff-textMuted">
                          This is your own feedback. Someone else needs to accept or close it.
                        </p>
                      ) : (
                        <>
                          <input
                            value={noteDrafts[it.id] ?? ""}
                            onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [it.id]: e.target.value }))}
                            placeholder="Add a reply note (optional), sent with the next decision below"
                            disabled={busy}
                            className="mb-2 mt-2 w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-xs disabled:opacity-60"
                          />
                          <div className="flex flex-wrap items-center gap-1.5">
                            {status !== "accepted" && (
                              <button
                                type="button"
                                onClick={() => setStatus(it.id, "accepted")}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:border-ff-success/40 hover:bg-ff-success/10 hover:text-ff-success disabled:opacity-60"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                Accept
                              </button>
                            )}
                            {status !== "closed" && (
                              <button
                                type="button"
                                onClick={() => setStatus(it.id, "closed")}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
                              >
                                <XCircle className="h-3.5 w-3.5" aria-hidden />
                                Close
                              </button>
                            )}
                            {status !== "open" && (
                              <button
                                type="button"
                                onClick={() => setStatus(it.id, "open")}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-textMuted transition-colors hover:bg-ff-lavender disabled:opacity-60"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                Reopen
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
