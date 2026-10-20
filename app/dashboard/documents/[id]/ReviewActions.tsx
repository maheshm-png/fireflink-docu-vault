"use client";

import { reviewersFor, type ReviewerOption } from "@/lib/reviewerOptions";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock, Download, EyeOff, Link2, Ban, MessageSquare, MessageSquareOff, Bell, BellOff, Sparkles, Check } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import InfoTooltip from "@/components/InfoTooltip";
import AlertModal from "@/components/AlertModal";

type VersionOption = { id: string; versionNumber: number; label: string };
type Reviewer = ReviewerOption;

export default function ReviewActions({
  documentId,
  versions,
  isOwnDocument,
  decideBlockedReason = null,
  myReportsToId,
  otherPendingReviewers,
  restrictedToTeamIds = null,
  currentVisibility = "org",
  currentDownloadable = true,
  currentTeamIds = [],
  currentTeamNames = [],
  teamOptions = [],
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
  // Set when this reviewer holds the assignment but may no longer decide it
  // (e.g. assigned before team roles, and not a manager of the document's
  // team): they can still reassign or ask for another review, so the
  // document never gets stuck.
  decideBlockedReason?: string | null;
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
  // Team ids of a restricted document (null for an org-wide one). Limits the
  // reassign/second-opinion pickers to managers of those teams, the same
  // rule the review route enforces (lib/access.ts).
  restrictedToTeamIds?: string[] | null;
  // What the uploader (or a later edit) chose for who can see it. The
  // reviewer must explicitly re-confirm or change this before approving
  // (mandatory, enforced by the review route too). teamOptions are the teams
  // this reviewer may tick, already filtered by app/dashboard/documents/[id]/
  // page.tsx; teams already on the document but not selectable show locked.
  currentVisibility?: "org" | "restricted";
  // Whether it can currently be downloaded. The approver must choose
  // "Allow download" or "Preview only" (lib/access.ts downloadsAllowed).
  currentDownloadable?: boolean;
  currentTeamIds?: string[];
  currentTeamNames?: string[];
  teamOptions?: { id: string; name: string; selectable: boolean }[];
}) {
  const willPublish = otherPendingReviewers === 0;
  const router = useRouter();
  const [comments, setComments] = useState("");
  const [versionId, setVersionId] = useState(versions[0]?.id);
  const [announce, setAnnounce] = useState<"yes" | "no" | null>(null);
  const [allowFeedback, setAllowFeedback] = useState<"yes" | "no" | null>(null);
  const [allowShare, setAllowShare] = useState<"yes" | "no" | null>(null);
  // Starts unanswered on purpose: approving requires an explicit choice.
  const [visibility, setVisibility] = useState<"org" | "restricted" | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>(currentTeamIds);
  const [downloads, setDownloads] = useState<"yes" | "no" | null>(null);
  const visibilityAnswered = visibility === "org" || (visibility === "restricted" && teamIds.length > 0);
  const effectiveDownloads = downloads;
  // Team documents never get a public link, so that question answers itself
  // too. A team document can't be opened to Everyone here ("Everyone" is
  // disabled below), so it's locked from the start, not only once "Who can
  // see it?" is answered: otherwise "Allowed" could be picked first and then
  // silently dropped on publish.
  const shareLocked = visibility === "restricted" || currentVisibility === "restricted";
  const effectiveShare = shareLocked ? "no" : allowShare;
  const answeredCount = [visibilityAnswered, effectiveDownloads !== null, effectiveShare !== null, allowFeedback !== null, announce !== null].filter(Boolean).length;
  const choicesMissing = willPublish && answeredCount < 5;

  // One click fills every answer with the usual choice, still shown so the
  // reviewer sees and can change each one before approving. Keeps who can
  // see it and downloads as they are now; a restricted document gets no
  // public link and a quiet publish.
  function useSuggested() {
    const restricted = currentVisibility === "restricted" && currentTeamIds.length > 0;
    setVisibility(restricted ? "restricted" : "org");
    setTeamIds(currentTeamIds);
    setDownloads(currentDownloadable ? "yes" : "no");
    setAllowShare(restricted ? "no" : "yes");
    setAllowFeedback("yes");
    setAnnounce(restricted ? "no" : "yes");
  }
  const [busy, setBusy] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [mode, setMode] = useState<"decide" | "reassign" | "second-opinion">(
    isOwnDocument || decideBlockedReason ? "reassign" : "decide"
  );
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [opinionPicks, setOpinionPicks] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/reviewers")
      .then((r) => r.json())
      .then((data: Reviewer[]) =>
        setReviewers(
          reviewersFor(data, restrictedToTeamIds ? "restricted" : "org", restrictedToTeamIds ?? [])
        )
      )
      .catch(() => {});
  }, [restrictedToTeamIds]);

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
        ...(decision === "approved"
          ? {
              announceToAll: willPublish && announce === "yes",
              allowFeedback: willPublish && allowFeedback === "yes",
              shareEnabled: willPublish && effectiveShare === "yes",
              // Non-final approvers re-send the current setting, like visibility.
              downloadable: willPublish ? effectiveDownloads === "yes" : currentDownloadable,
              // Only the approval that publishes applies this, so a
              // non-final approver just re-sends the current setting.
              visibility: willPublish ? visibility : currentVisibility,
              teamIds: willPublish ? (visibility === "restricted" ? teamIds : []) : currentTeamIds,
              versionId,
            }
          : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setActionError(data?.error ?? "Could not complete this action, please try again.");
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
      setActionError(data?.error ?? "Could not reassign, please try again.");
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
      setActionError(data?.error ?? "Could not request additional review, please try again.");
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
        <h2 className="text-base font-bold text-ff-text">Review Submission</h2>
        <div className="flex gap-1 rounded-ff border border-ff-border bg-ff-lavender/40 p-0.5 text-xs">
          {!isOwnDocument && !decideBlockedReason && (
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
      {decideBlockedReason && !isOwnDocument && (
        <p className="mb-3 text-xs text-ff-textMuted">{decideBlockedReason}</p>
      )}

      {mode === "decide" && !isOwnDocument && !decideBlockedReason && (
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
                    {v.label}
                    {v.id === versions[0].id ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {willPublish ? (
            <div className="mb-4 rounded-ff border border-ff-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ff-border bg-ff-lavender/30 px-3 py-2">
                <p className="text-sm font-semibold text-ff-text">
                  Before publishing{" "}
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${answeredCount === 5 ? "bg-ff-success/15 text-ff-success" : "bg-white text-ff-textMuted"}`}>
                    {answeredCount}/5 answered
                  </span>
                </p>
                <button
                  type="button"
                  onClick={useSuggested}
                  className="flex items-center gap-1 rounded-ff border border-ff-accent/40 bg-white px-2.5 py-1 text-xs font-medium text-ff-accent hover:bg-ff-accent/5"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Use suggested answers
                </button>
              </div>

              <div className="divide-y divide-ff-border">
                <QuestionRow
                  label="Who can see it?"
                  hint={`Now: ${currentVisibility === "restricted" ? currentTeamNames.join(", ") || "selected teams" : "everyone"}`}
                  value={visibility}
                  onChange={(v) => setVisibility(v)}
                  options={[
                    // A team document goes to everyone only through Request
                    // for Everyone after publishing (lib/access.ts).
                    { value: "org", label: "Everyone", Icon: Globe, disabled: currentVisibility === "restricted" },
                    { value: "restricted", label: "Selected teams", Icon: Lock },
                  ]}
                />
                {currentVisibility === "restricted" && (
                  <p className="bg-ff-lavender/20 px-3 pb-2 text-xs text-ff-textMuted">
                    To open a team document to everyone, publish it, then use Request for Everyone on its Manage tab.
                  </p>
                )}
                {visibility === "restricted" && (
                  <div className="bg-ff-lavender/20 px-3 py-2">
                    <p className="mb-1.5 text-xs text-ff-textMuted">
                      Tap the teams that can see it{teamIds.length === 0 ? " (pick at least one)" : ""}:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {teamOptions.length === 0 && (
                        <p className="text-xs text-ff-warning">No teams exist yet. A superadmin can add them under Teams.</p>
                      )}
                      {teamOptions.map((t) => {
                        const checked = teamIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={!t.selectable}
                            aria-pressed={checked}
                            title={t.selectable ? undefined : "You can't change this team"}
                            onClick={() =>
                              setTeamIds((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))
                            }
                            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              checked
                                ? "border-ff-accent bg-ff-accent text-white"
                                : "border-ff-border bg-white text-ff-text hover:border-ff-accent/50"
                            }`}
                          >
                            {checked && <Check className="h-3 w-3" aria-hidden />}
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <QuestionRow
                  label="Can people download it?"
                  value={effectiveDownloads}
                  onChange={(v) => setDownloads(v)}
                  options={[
                    { value: "yes", label: "Allow download", Icon: Download },
                    { value: "no", label: "Preview only", Icon: EyeOff },
                  ]}
                />
                <QuestionRow
                  label="Public share link?"
                  hint={shareLocked ? "Team documents can't be shared outside the company." : undefined}
                  value={effectiveShare}
                  onChange={(v) => setAllowShare(v)}
                  locked={shareLocked}
                  options={[
                    { value: "yes", label: "Allowed", Icon: Link2 },
                    { value: "no", label: "Not allowed", Icon: Ban },
                  ]}
                />
                <QuestionRow
                  label="Accept feedback?"
                  value={allowFeedback}
                  onChange={(v) => setAllowFeedback(v)}
                  options={[
                    { value: "yes", label: "Yes", Icon: MessageSquare },
                    { value: "no", label: "No", Icon: MessageSquareOff },
                  ]}
                />
                <QuestionRow
                  label="Notify people?"
                  hint="Only people who can see it are notified."
                  value={announce}
                  onChange={(v) => setAnnounce(v)}
                  options={[
                    { value: "yes", label: "Notify", Icon: Bell },
                    { value: "no", label: "Publish quietly", Icon: BellOff },
                  ]}
                />
              </div>
            </div>
          ) : (
            <p className="mb-4 text-xs text-ff-textMuted">
              {otherPendingReviewers} other reviewer{otherPendingReviewers === 1 ? "" : "s"} still need
              {otherPendingReviewers === 1 ? "s" : ""} to decide before this publishes.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              disabled={busy || choicesMissing}
              onClick={() => decide("approved")}
              title={choicesMissing ? "Answer the questions above first" : undefined}
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
            {choicesMissing && (
              <span className="text-xs text-ff-textMuted">
                Answer the {5 - answeredCount} remaining question{5 - answeredCount === 1 ? "" : "s"} above to enable Approve.
              </span>
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
          <p className="mb-3 flex items-center gap-1 text-xs text-ff-textMuted">
            Pick extra reviewers
            <InfoTooltip text="They review alongside you. The document publishes once everyone picked here, and you, has approved." />
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

// One approval question: a short label and two big tap targets. Nothing is
// preselected, so every answer is a deliberate choice (or "Use suggested
// answers", which still shows each one).
function QuestionRow<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  locked = false,
}: {
  label: string;
  hint?: string;
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; Icon: typeof Globe; disabled?: boolean }[];
  locked?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ff-text">
          {label} {value === null && <span className="text-ff-danger">*</span>}
        </p>
        {hint && <p className="text-xs text-ff-textMuted">{hint}</p>}
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {options.map(({ value: v, label: optionLabel, Icon, disabled }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked || disabled}
              onClick={() => onChange(v)}
              className={`flex items-center gap-1.5 rounded-ff border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                selected
                  ? "border-ff-accent bg-ff-accent text-white"
                  : `border-ff-border bg-white text-ff-text hover:border-ff-accent/50 ${locked || disabled ? "opacity-40" : ""}`
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {optionLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
