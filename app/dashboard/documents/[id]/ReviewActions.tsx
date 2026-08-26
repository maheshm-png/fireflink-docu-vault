"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

type VersionOption = { id: string; versionNumber: number };
type Reviewer = { id: string; name: string; role: string; reportsToId: string | null };

export default function ReviewActions({
  documentId,
  versions,
  isOwnDocument,
  myReportsToId,
  otherPendingReviewers,
}: {
  documentId: string;
  versions: VersionOption[];
  // True when the acting reviewer is also this document's uploader —
  // approving your own document is blocked server-side (app/api/documents/
  // [id]/review/route.ts), so the Approve button is hidden here instead of
  // just failing after the fact. Deliberately not document.ownerId — that
  // field is the reviewer picked at upload time, not the uploader, so it
  // must never disqualify someone from reviewing their own assignment.
  isOwnDocument: boolean;
  // This reviewer's own reporting manager, if set (app/admin/users) — shown
  // as a one-click "escalate to my manager" shortcut in the reassign picker.
  myReportsToId: string | null;
  // How many OTHER reviewers still have a pending row on this document (a
  // second/third opinion round). While that's non-zero, this reviewer's own
  // approval can't be the one that publishes — see the "stillPending" check
  // in app/api/documents/[id]/review/route.ts — so the button shouldn't
  // claim "& Publish", and asking this reviewer to decide the announce-to-
  // all question is moot (only whichever approval turns out to be last
  // actually uses that value).
  otherPendingReviewers: number;
}) {
  const willPublish = otherPendingReviewers === 0;
  const router = useRouter();
  const [comments, setComments] = useState("");
  const [versionId, setVersionId] = useState(versions[0]?.id);
  const [announce, setAnnounce] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [mode, setMode] = useState<"decide" | "reassign" | "second-opinion">(isOwnDocument ? "reassign" : "decide");
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [opinionPicks, setOpinionPicks] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/reviewers")
      .then((r) => r.json())
      .then(setReviewers)
      .catch(() => {});
  }, []);

  const suggestedEscalation = myReportsToId ? reviewers.find((r) => r.id === myReportsToId) : undefined;

  async function decide(decision: "approved" | "rejected") {
    if (decision === "rejected" && comments.trim() === "") {
      setCommentsError(true);
      return;
    }
    setCommentsError(false);
    setActionError(null);
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decide",
        decision,
        comments,
        ...(decision === "approved" ? { announceToAll: willPublish && announce === "yes", versionId } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setActionError(data?.error ?? "Could not complete this action — please try again.");
      return;
    }
    router.refresh();
  }

  async function reassign() {
    if (!reassignTo) {
      setActionError("Choose who this should go to.");
      return;
    }
    setActionError(null);
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reassign", newReviewerId: reassignTo }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setActionError(data?.error ?? "Could not reassign — please try again.");
      return;
    }
    router.refresh();
  }

  async function requestSecondOpinion() {
    if (opinionPicks.size === 0) {
      setActionError("Pick at least one reviewer to bring in.");
      return;
    }
    setActionError(null);
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add-reviewers", reviewerIds: [...opinionPicks] }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setActionError(data?.error ?? "Could not request additional review — please try again.");
      return;
    }
    setOpinionPicks(new Set());
    router.refresh();
  }

  function toggleOpinionPick(id: string) {
    setOpinionPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-ff-text">Review this submission</h2>
        <div className="flex gap-1 rounded-ff border border-ff-border bg-ff-lavender/40 p-0.5 text-xs">
          {!isOwnDocument && (
            <button
              onClick={() => setMode("decide")}
              className={`rounded-ff px-2.5 py-1 ${mode === "decide" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
            >
              Approve / Reject
            </button>
          )}
          <button
            onClick={() => setMode("reassign")}
            className={`rounded-ff px-2.5 py-1 ${mode === "reassign" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
          >
            Reassign
          </button>
          <button
            onClick={() => setMode("second-opinion")}
            className={`rounded-ff px-2.5 py-1 ${mode === "second-opinion" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
          >
            Request Additional Review
          </button>
        </div>
      </div>

      {isOwnDocument && mode === "decide" && (
        <p className="mb-3 text-xs text-ff-textMuted">
          You can&apos;t approve your own document. Reassign it to another reviewer instead.
        </p>
      )}

      {mode === "decide" && !isOwnDocument && (
        <>
          <textarea
            value={comments}
            onChange={(e) => {
              setComments(e.target.value);
              if (commentsError) setCommentsError(false);
            }}
            placeholder="Comments or observations for the uploader (required to reject)"
            className={`mb-1 w-full rounded-ff border p-2 text-sm ${commentsError ? "border-ff-danger" : "border-ff-border"}`}
            rows={2}
          />
          <p className="mb-3 text-xs text-ff-danger">
            {commentsError ? "Add a comment explaining why, so the uploader knows what to fix." : " "}
          </p>

          {versions.length > 1 && (
            <label className="mb-4 flex items-center gap-2 text-sm">
              <span className="text-ff-text">Version to publish</span>
              <select
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
                className="rounded-ff border border-ff-border px-2 py-1"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber}
                    {v.id === versions[0].id ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {willPublish ? (
            <fieldset className="mb-4 rounded-ff border border-ff-border p-3">
              <legend className="px-1 text-xs font-medium text-ff-text">
                Send a &quot;new document published&quot; notification to all users? <span className="text-ff-danger">*</span>
              </legend>
              <div className="mt-1 flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="announce" required checked={announce === "yes"} onChange={() => setAnnounce("yes")} />
                  Yes, announce it
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="announce" required checked={announce === "no"} onChange={() => setAnnounce("no")} />
                  No, publish quietly
                </label>
              </div>
            </fieldset>
          ) : (
            <p className="mb-4 text-xs text-ff-textMuted">
              {otherPendingReviewers} other reviewer{otherPendingReviewers === 1 ? "" : "s"} still need
              {otherPendingReviewers === 1 ? "s" : ""} to decide before this publishes.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              disabled={busy || (willPublish && announce === null)}
              onClick={() => decide("approved")}
              title={willPublish && announce === null ? "Choose whether to announce this publish first" : undefined}
              className="flex items-center justify-center rounded-ff bg-ff-success px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <BrandedLoader size={16} variant="white" /> : willPublish ? "Approve & Publish" : "Approve"}
            </button>
            <button
              disabled={busy}
              onClick={() => decide("rejected")}
              className="flex items-center justify-center rounded-ff bg-ff-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <BrandedLoader size={16} variant="white" /> : "Reject"}
            </button>
            {willPublish && announce === null && (
              <span className="text-xs text-ff-textMuted">Pick Yes or No above to enable Approve.</span>
            )}
          </div>
        </>
      )}

      {mode === "reassign" && (
        <div>
          <p className="mb-3 text-xs text-ff-textMuted">
            Hands this off to someone else entirely. They take over your review assignment.
          </p>
          {suggestedEscalation && (
            <button
              onClick={() => setReassignTo(suggestedEscalation.id)}
              className={`mb-3 flex w-full items-center justify-between rounded-ff border p-2.5 text-left text-sm transition-colors ${
                reassignTo === suggestedEscalation.id ? "border-ff-accent bg-ff-accent/5" : "border-ff-border hover:bg-ff-lavender/40"
              }`}
            >
              <span>
                Escalate to your manager: <strong>{suggestedEscalation.name}</strong>
              </span>
              {reassignTo === suggestedEscalation.id && <span className="text-ff-accent">Selected</span>}
            </button>
          )}
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-ff-textMuted">Or choose any manager</span>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            >
              <option value="">Choose a reviewer...</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !reassignTo}
            onClick={reassign}
            className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <BrandedLoader size={16} variant="white" /> : "Reassign"}
          </button>
        </div>
      )}

      {mode === "second-opinion" && (
        <div>
          <p className="mb-3 text-xs text-ff-textMuted">
            Brings in additional reviewer(s) alongside your own review. The document publishes once everyone
            picked here (and you) has approved.
          </p>
          <div className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-ff border border-ff-border p-2">
            {reviewers.length === 0 && <p className="p-2 text-xs text-ff-textMuted">No other managers available.</p>}
            {reviewers.map((r) => (
              <label key={r.id} className="flex items-center gap-2 rounded p-1.5 text-sm hover:bg-ff-lavender/40">
                <input
                  type="checkbox"
                  checked={opinionPicks.has(r.id)}
                  onChange={() => toggleOpinionPick(r.id)}
                />
                {r.name}
                {r.id === myReportsToId && <span className="text-xs text-ff-textMuted">(your manager)</span>}
              </label>
            ))}
          </div>
          <button
            disabled={busy || opinionPicks.size === 0}
            onClick={requestSecondOpinion}
            className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <BrandedLoader size={16} variant="white" /> : `Request review from ${opinionPicks.size || ""}`.trim()}
          </button>
        </div>
      )}

      <AlertModal message={actionError} onClose={() => setActionError(null)} />
    </div>
  );
}
