"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { formatDateTime } from "@/lib/formatDate";
import type { RoundGroup, RoundAttemptEvent } from "@/lib/versionRounds";

type ReviewRequestRow = {
  id: string;
  roundNumber: number;
  status: string;
  comments: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  reviewer: { name: string };
  requestedBy: { name: string };
};

type InlineCommentRow = {
  id: string;
  reviewRequestId: string;
  highlightedText: string | null;
  comment: string;
  // Unused by this component's own rendering — carried through only so
  // ReviewTrailWithHighlights.tsx can pass it on to
  // components/ReviewHighlightsViewer.tsx's "(edited)" marker.
  editedAt?: string | null;
};

type Stage = "done" | "current" | "rejected" | "closed" | "revoked" | "upcoming";

type AttemptSelection = { round: number; attempt: number };

// Flat, muted fills — no gradient, no shadow. A saturated gradient badge on
// every step reads as a game achievement/progress-tracker, not enterprise
// software; gradients here stay reserved for primary action buttons only
// (Download, Approve, etc.), same as before this component existed.
const DOT_STYLE: Record<Stage, string> = {
  done: "bg-ff-success text-white",
  current: "bg-ff-warning text-white animate-pulse",
  rejected: "bg-ff-danger text-white",
  closed: "bg-ff-textMuted/30 text-ff-textMuted",
  revoked: "bg-ff-warning text-white",
  upcoming: "bg-ff-lavender text-ff-textMuted",
};

const EVENT_TAG: Record<Exclude<RoundAttemptEvent, "attempt">, string> = {
  recheck: "Recheck",
  "second-opinion": "Second Opinion",
};

// A reviewer's row is force-set to "rejected" when a DIFFERENT reviewer
// (same or another round) rejects first — see the reject handling in
// app/api/documents/[id]/review/route.ts. That's a real status change (their
// row really is closed out and no longer actionable) but not a decision
// THEY made, so it shouldn't read as if they personally rejected it.
function isAutoClosed(r: { status: string; comments: string | null }) {
  return r.status === "rejected" && (r.comments?.startsWith("Auto-closed:") ?? false);
}

type Step = {
  key: string;
  stage: Stage;
  label: string;
  // Short text for the dot itself — the label below it can be a full
  // phrase ("Round 1"), but the dot has room for a couple characters at
  // most.
  glyph?: string;
  tooltip: string;
  round?: number;
  attempt?: number;
  // Every ReviewRequest row across every ATTEMPT in this round (a round
  // with just one attempt has just one attempt's rows; multiple rejected-
  // and-resubmitted attempts, or a recheck/second-opinion round, all land
  // here too), each tagged with its own attempt's version label and event
  // type so the detail view below can still tell them apart within the
  // one combined round step.
  rows?: (ReviewRequestRow & { event: RoundAttemptEvent; versionLabel: string; attemptNumber: number })[];
};

/** Delivery-tracker-style horizontal step bar (Uploaded → Round 1 → Round 2
 * → Published[/Revoked → Round 3 ...]) for a document's review history —
 * same idea as an Amazon order tracker. Each dot is a ROUND (lib/
 * versionRounds.ts's Round.Attempt grouping), not a raw ReviewRequest round
 * or individual attempt — a round that took a rejected attempt or two
 * before finally being approved still gets just one dot, reflecting where
 * it landed; clicking that dot opens the detail breakdown below showing
 * every attempt within it (v1.0 rejected, v1.1 approved, etc — see the
 * expandedRound state below), rather than the stepper itself growing one
 * dot per attempt. Rounds are placed chronologically: any round created
 * after a revoke shows up after the Revoked step rather than before
 * Published, since that's when it actually happened (a re-review triggered
 * by the revoke, not part of the original approval that led to the first
 * publish). See lib/versionRounds.ts's own header comment for what Round
 * vs Attempt means; this is a visual read of that computed data, not a
 * separate source of truth. */
export default function ReviewTrail({
  documentStatus,
  uploadedByName,
  uploadedAt,
  reviewRequests,
  inlineComments,
  revoked,
  roundGroups,
  onCommentClick,
  activeComment,
  onActiveCommentChange,
  documentViewer,
}: {
  documentStatus: string;
  uploadedByName: string;
  uploadedAt: Date;
  reviewRequests: ReviewRequestRow[];
  // A round's highlight-and-comment feedback (components/
  // InlineCommentReview.tsx) — only ever rendered below a row whose round
  // is already resolved, same as that row's own `comments` field, so
  // nothing about a still-pending round leaks to the uploader/owner ahead
  // of the actual decision.
  inlineComments?: InlineCommentRow[];
  // Only meaningful when documentStatus is "revoked" — a document has to
  // have been published before it can be revoked, so the trail shows
  // Published (done) followed by this extra step rather than replacing it.
  revoked?: { byName: string; at: Date; reason: string | null } | null;
  // lib/versionRounds.ts's computeRoundAttempts output — computed once,
  // server-side, in app/dashboard/documents/[id]/page.tsx and threaded
  // through ReviewTrailWithHighlights.tsx down to here. The single source
  // of truth for "which ReviewRequest rounds make up which Round.Attempt."
  roundGroups: RoundGroup[];
  // When provided, each inline comment row becomes clickable — see
  // components/ReviewTrailWithHighlights.tsx, which wires this to
  // components/ReviewHighlightsViewer.tsx so clicking a comment jumps to
  // and flashes it on the actual rendered document. Omitted (rows render
  // as plain text) wherever that document view isn't also on the page.
  onCommentClick?: (commentId: string) => void;
  // The "Document Comments" round+attempt selection lives in the parent
  // (components/ReviewTrailWithHighlights.tsx) instead of as local state
  // here, because that parent also has to pick which version's document
  // actually renders underneath — both need to change together when the
  // selection does, not just this list.
  activeComment: AttemptSelection | null;
  onActiveCommentChange: (selection: AttemptSelection) => void;
  // The actual rendered document (with reviewer highlight overlays), built
  // by components/ReviewTrailWithHighlights.tsx — rendered inside THIS
  // section (right below the comment list) rather than as a separate card
  // after it, so "read the comments" and "see where they landed on the
  // document" live in one merged place instead of two stacked ones. Omitted
  // wherever there's no document to show at all (a docType with no
  // versions, e.g. "link").
  documentViewer?: ReactNode;
}) {
  // formatDateTime uses toLocaleString, which resolves to the server's
  // timezone (UTC in production) during the initial server-rendered pass —
  // wrong for anyone not in UTC. Gating it behind `mounted` means the first
  // client render matches that same (date-less) server output, avoiding a
  // hydration mismatch, then fills in the viewer's actual local time right
  // after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Arriving here via a decision notification (components/
  // NotificationBell.tsx links approved/rejected/revoked notices straight
  // to #review-status) briefly rings this whole section so it's obvious
  // where to look, on top of the browser's own scroll-to-anchor — a plain
  // jump with nothing to draw the eye left it unclear whether the page had
  // actually gone anywhere.
  const [justArrived, setJustArrived] = useState(false);
  useEffect(() => {
    if (window.location.hash !== "#review-status") return;
    setJustArrived(true);
    const timeout = setTimeout(() => setJustArrived(false), 2200);
    return () => clearTimeout(timeout);
  }, []);

  // The current (newest) round's breakdown always shows — it's the one
  // actually in progress or just decided, not history to dig for. Older
  // rounds stay collapsed until asked for, and asking for one shows ONLY
  // that round's own attempts, not every earlier round at once — clicking
  // round 1's dot and then round 3's dot switches which one is expanded
  // rather than piling both open. null means nothing extra is expanded.
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  // Collapses the whole Document Comments section (round/attempt selector
  // plus the list itself) — its own toggle, independent of Review Status's
  // "Show Previous History" above, since this section can be long even when
  // there's only one round.
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);

  const reviewRequestById = Object.fromEntries(reviewRequests.map((r) => [r.id, r]));
  const reviewRequestsByRound = new Map<number, ReviewRequestRow[]>();
  for (const r of reviewRequests) {
    if (!reviewRequestsByRound.has(r.roundNumber)) reviewRequestsByRound.set(r.roundNumber, []);
    reviewRequestsByRound.get(r.roundNumber)!.push(r);
  }

  function attemptRows(a: RoundGroup["attempts"][number]) {
    return a.rounds.flatMap(({ roundNumber, event }) =>
      (reviewRequestsByRound.get(roundNumber) ?? []).map((r) => ({ ...r, event }))
    );
  }

  function attemptStage(rows: ReviewRequestRow[]): Stage {
    if (rows.some((r) => r.status === "rejected" && !isAutoClosed(r))) return "rejected";
    if (rows.length > 0 && rows.every((r) => r.status === "approved")) return "done";
    // Every row in this attempt got auto-closed by a rejection elsewhere —
    // nobody assigned here ever actually got to decide.
    if (rows.length > 0 && rows.every((r) => isAutoClosed(r))) return "closed";
    return "current";
  }

  // One Step per ROUND (not per attempt, not per raw ReviewRequest round) —
  // every attempt within it (a rejected v1.0 followed by an approved v1.1,
  // say) folds into this single dot; its stage reflects the LAST attempt's
  // outcome (a round that ended in approval reads "done" even though an
  // earlier attempt in it was rejected — that earlier rejection is history
  // inside the round, not a separate stop on the tracker). Clicking the dot
  // (see the stepper's onClick below) reveals that round in the detail view
  // rather than the stepper itself growing one dot per attempt.
  const roundSteps: Step[] = roundGroups.map((g) => {
    const rows = g.attempts.flatMap((a) => attemptRows(a).map((r) => ({ ...r, versionLabel: a.label, attemptNumber: a.attempt + 1 })));
    const lastAttempt = g.attempts[g.attempts.length - 1];
    const stage = attemptStage(attemptRows(lastAttempt));
    const label = `Round ${g.round}`;
    return {
      key: `round-${g.round}`,
      stage,
      label,
      glyph: String(g.round),
      tooltip: `${label} review${
        stage === "current" ? " (in progress)" : stage === "rejected" ? " (rejected)" : stage === "closed" ? " (closed)" : ""
      }. Click to view.`,
      round: g.round,
      rows,
    };
  });
  const stageByRound = new Map(roundSteps.map((s) => [s.round!, s.stage]));

  // One block per ATTEMPT (unlike roundSteps above) — this drives the
  // detail breakdown below, not the stepper dots. A round that took a
  // rejected attempt before finally being approved gets one dot up top,
  // but its rejected attempt is still its own row here: only the single
  // MOST RECENT attempt overall — even a rejected one still awaiting
  // resubmission within the current round — stays permanently visible;
  // every earlier attempt, including earlier ones in that SAME round,
  // counts as Previous History and collapses behind it.
  const attemptBlocks: Step[] = roundGroups.flatMap((g) =>
    g.attempts.map((a) => ({
      key: `attempt-${a.label}`,
      stage: attemptStage(attemptRows(a)),
      label: a.label,
      // Not rendered anywhere (only roundSteps' dots show a tooltip) —
      // just here to satisfy Step's shape.
      tooltip: a.label,
      round: g.round,
      attempt: a.attempt,
      rows: attemptRows(a).map((r) => ({ ...r, versionLabel: a.label, attemptNumber: a.attempt + 1 })),
    }))
  );

  // Same "happened after the revoke" split as before, now applied to
  // rounds — a round's earliest row created at/after the revoke timestamp
  // is the re-review round, not one that led to the original publish.
  const roundEarliestCreatedAt = (s: Step) => Math.min(...(s.rows ?? []).map((r) => r.createdAt.getTime()));
  const roundsBeforeRevoke = revoked
    ? roundSteps.filter((s) => roundEarliestCreatedAt(s) < revoked.at.getTime())
    : roundSteps;
  const roundsAfterRevoke = revoked ? roundSteps.filter((s) => !roundsBeforeRevoke.includes(s)) : [];

  // A revoked document was published first — the trail should still read
  // that way (Published, done) rather than jumping straight to a warning.
  const finalStage: Stage =
    documentStatus === "published" || documentStatus === "revoked"
      ? "done"
      : documentStatus === "rejected"
      ? "rejected"
      : "upcoming";

  const steps: Step[] = [
    {
      key: "uploaded",
      stage: "done",
      label: "Uploaded",
      tooltip: mounted
        ? `Uploaded by ${uploadedByName} · ${formatDateTime(uploadedAt)}`
        : `Uploaded by ${uploadedByName}`,
    },
    ...roundsBeforeRevoke,
    {
      key: "final",
      stage: finalStage,
      label: finalStage === "rejected" ? "Rejected" : "Published",
      tooltip: finalStage === "rejected" ? "Rejected" : "Published",
    },
    ...(documentStatus === "revoked"
      ? [
          {
            key: "revoked",
            stage: "revoked" as Stage,
            label: "Revoked",
            tooltip: [
              `Revoked${revoked?.byName ? ` by ${revoked.byName}` : ""}`,
              mounted && revoked?.at ? formatDateTime(revoked.at) : null,
              revoked?.reason,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : []),
    ...roundsAfterRevoke,
  ];

  const detailSteps = attemptBlocks.filter((s) => s.rows && s.rows.length > 0);
  // The last one is always the current attempt — never collapsed away, see
  // expandedRound's own comment. Everything before it, including an
  // earlier rejected attempt in the SAME round as the current one, is
  // Previous History.
  const currentDetailStep = detailSteps[detailSteps.length - 1];
  const previousDetailSteps = detailSteps.slice(0, -1);
  // Only the expanded round's own earlier attempts join the always-visible
  // current one — not every previous round at once. If the current round
  // itself is what's expanded (it can have earlier attempts of its own,
  // e.g. a rejected v2.0 before the pending v2.1), this still resolves
  // correctly since previousDetailSteps only ever holds OTHER attempts.
  const expandedDetailSteps =
    expandedRound !== null ? previousDetailSteps.filter((s) => s.round === expandedRound) : [];
  const visibleDetailSteps = currentDetailStep ? [...expandedDetailSteps, currentDetailStep] : [];

  // A flat list of every resolved attempt's inline (highlight-and-comment)
  // feedback, decoupled from the decision timeline above — mixing "who
  // decided what" with "comments on specific passages" into one card was
  // the actual source of confusion this component used to have. Each
  // comment is labeled with its own reviewer rather than nested under an
  // attempt block, so it reads as a standalone annotation list (see
  // components/ReviewHighlightsViewer.tsx, which this list drives via
  // onCommentClick — clicking a row jumps to and flashes it there).
  const reviewerNameByRequestId = Object.fromEntries(reviewRequests.map((r) => [r.id, r.reviewer.name]));
  // Which (round, attempt) a given ReviewRequest.roundNumber maps to — a
  // recheck/second-opinion round reuses its predecessor's attempt, so its
  // own comments (if any) fold into that same attempt bucket rather than
  // getting a separate one.
  const attemptByRoundNumber = new Map<number, AttemptSelection>();
  for (const g of roundGroups) {
    for (const a of g.attempts) {
      for (const { roundNumber } of a.rounds) attemptByRoundNumber.set(roundNumber, { round: g.round, attempt: a.attempt });
    }
  }
  const resolvedRequestIds = new Set(reviewRequests.filter((r) => r.status !== "pending").map((r) => r.id));
  const visibleComments = (inlineComments ?? []).filter((c) => resolvedRequestIds.has(c.reviewRequestId));

  const currentGroup = roundGroups[roundGroups.length - 1];
  const currentAttempt = currentGroup?.attempts[currentGroup.attempts.length - 1];
  // One tab per attempt that has comments, PLUS the actual current attempt
  // even if it has none yet (a fresh attempt's own comments never appear in
  // visibleComments until it's resolved, per the resolvedRequestIds filter
  // above — without adding it explicitly here, a brand-new attempt with no
  // decision yet would have no tab at all, and the most recent attempt WITH
  // comments would default-select instead, looking like "the current
  // status" when it's really just old reference).
  const realCommentAttemptKeys = new Set(
    visibleComments
      .map((c) => {
        const sel = attemptByRoundNumber.get(reviewRequestById[c.reviewRequestId]?.roundNumber ?? -1);
        return sel ? `${sel.round}.${sel.attempt}` : null;
      })
      .filter((key): key is string => key !== null)
  );
  // Every resolved attempt across every round gets its own capsule here,
  // not just the ones that actually received highlight-and-comment
  // feedback — a version with zero comments should still be selectable
  // (see the "No Comments for this Version" fallback below) rather than
  // its tab simply not existing.
  const commentAttemptKeys = new Set<string>();
  for (const g of roundGroups) {
    for (const a of g.attempts) commentAttemptKeys.add(`${g.round}.${a.attempt}`);
  }
  const commentRoundNumbers = [...new Set([...commentAttemptKeys].map((k) => Number(k.split(".")[0])))].sort((a, b) => a - b);
  // Rounds/attempts that actually HAVE a comment, as opposed to
  // commentAttemptKeys/commentRoundNumbers above, which also include the
  // current round/attempt purely so it always gets a tab even when empty
  // (see the comment above commentAttemptKeys.add). Used below so the
  // section defaults to showing real feedback instead of defaulting to the
  // current round and rendering "No comments yet" while an earlier round's
  // actual comments sit one click away, unseen.
  const realCommentRoundNumbers = [...new Set([...realCommentAttemptKeys].map((k) => Number(k.split(".")[0])))].sort((a, b) => a - b);

  const selectedRound =
    activeComment && commentRoundNumbers.includes(activeComment.round)
      ? activeComment.round
      : realCommentRoundNumbers[realCommentRoundNumbers.length - 1] ??
        currentGroup?.round ??
        commentRoundNumbers[commentRoundNumbers.length - 1] ??
        null;
  const selectedRoundGroup = roundGroups.find((g) => g.round === selectedRound);
  const attemptsForSelectedRound = (selectedRoundGroup?.attempts ?? []).filter((a) =>
    commentAttemptKeys.has(`${selectedRound}.${a.attempt}`)
  );
  const attemptsWithRealCommentsForSelectedRound = attemptsForSelectedRound.filter((a) =>
    realCommentAttemptKeys.has(`${selectedRound}.${a.attempt}`)
  );
  const selectedAttempt =
    activeComment && activeComment.round === selectedRound && attemptsForSelectedRound.some((a) => a.attempt === activeComment.attempt)
      ? activeComment.attempt
      : attemptsWithRealCommentsForSelectedRound[attemptsWithRealCommentsForSelectedRound.length - 1]?.attempt ??
        attemptsForSelectedRound[attemptsForSelectedRound.length - 1]?.attempt ??
        null;
  const selectedKey = selectedRound !== null && selectedAttempt !== null ? `${selectedRound}.${selectedAttempt}` : null;
  const selectedRoundComments = visibleComments.filter((c) => {
    const sel = attemptByRoundNumber.get(reviewRequestById[c.reviewRequestId]?.roundNumber ?? -1);
    return sel && `${sel.round}.${sel.attempt}` === selectedKey;
  });
  const selectedLabel = selectedRoundGroup?.attempts.find((a) => a.attempt === selectedAttempt)?.label ?? "";

  return (
    <>
    <section
      id="review-status"
      className={`mb-6 scroll-mt-4 rounded-ff border bg-white p-4 shadow-ff transition-colors duration-700 ${
        justArrived ? "border-ff-accent ring-2 ring-ff-accent/40" : "border-ff-border"
      }`}
    >
      <h2 className="mb-4 text-base font-bold text-ff-text">Review Status</h2>

      <div className="flex items-start overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            {i > 0 && (
              <div
                className={`mt-3.5 h-0.5 min-w-[16px] flex-1 ${
                  steps[i - 1].stage === "done" ? "bg-ff-success" : "bg-ff-border"
                }`}
              />
            )}
            <div className="group flex shrink-0 flex-col items-center px-0.5" title={step.tooltip}>
              {/* Clickable only for round steps (the ones with rows) —
                  clicking a round expands ONLY that round's own attempt
                  breakdown (including the current one, if it has an earlier
                  rejected attempt sitting before its latest), switching away
                  from whichever round was expanded before rather than
                  stacking both open. Clicking the already-expanded round
                  again collapses it back down. */}
              {step.round !== undefined && step.rows && step.rows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setExpandedRound((cur) => (cur === step.round ? null : step.round!))}
                  aria-pressed={step.round === currentDetailStep?.round || step.round === expandedRound}
                  className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[10px] font-medium transition-all hover:scale-110 ${DOT_STYLE[step.stage]} ${
                    step.round === currentDetailStep?.round
                      ? "ring-2 ring-offset-1 ring-ff-accent"
                      : "hover:ring-2 hover:ring-offset-1 hover:ring-ff-accent/50"
                  }`}
                >
                  {step.stage === "done" ? "✓" : step.stage === "rejected" ? "✕" : step.stage === "closed" ? "–" : step.glyph ?? ""}
                </button>
              ) : (
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${DOT_STYLE[step.stage]}`}
                >
                  {step.stage === "done"
                    ? "✓"
                    : step.stage === "rejected"
                    ? "✕"
                    : step.stage === "closed"
                    ? "–"
                    : step.stage === "revoked"
                    ? "↩"
                    : step.glyph ?? ""}
                </span>
              )}
              <p
                className={`mt-1 max-w-[72px] text-center text-[11px] leading-tight ${
                  step.stage === "upcoming" || step.stage === "closed" ? "text-ff-textMuted" : "text-ff-text"
                } ${step.round !== undefined && step.rows && step.rows.length > 0 ? "group-hover:text-ff-accent group-hover:underline" : ""}`}
              >
                {step.label}
              </p>
            </div>
          </Fragment>
        ))}
      </div>

      {detailSteps.length > 0 && (
        <div className="mt-4 border-t border-ff-border pt-4">
          {previousDetailSteps.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setExpandedRound((cur) =>
                  cur !== null ? null : previousDetailSteps[previousDetailSteps.length - 1].round!
                )
              }
              className="mb-4 flex items-center gap-1 text-xs font-medium text-ff-accent hover:underline"
            >
              {expandedRound !== null ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {expandedRound !== null ? "Collapse Previous History" : "Show Previous History"}
            </button>
          )}
          {visibleDetailSteps.map((step, stepIdx, visibleSteps) => {
            // The current round's attempt is always appended after whatever
            // round got expanded above (see expandedRound's own comment) —
            // without a divider between them, a different round's attempt
            // sitting right after Round 1's rows with nothing marking the
            // boundary reads as if it belongs to Round 1 too. Only shown at
            // the actual boundary, not before the very first step.
            const isNewRoundInList = stepIdx === 0 || visibleSteps[stepIdx - 1].round !== step.round;
            return (
            <div key={step.key}>
              {isNewRoundInList && (
                <p className={`text-[11px] font-bold uppercase tracking-wide text-ff-textMuted ${stepIdx === 0 ? "mb-2" : "mb-2 mt-1 border-t border-ff-border pt-4"}`}>
                  Round {step.round}
                </p>
              )}
              {step.rows!.map((r, rowIdx) => {
              const isLastOverall = stepIdx === visibleSteps.length - 1 && rowIdx === step.rows!.length - 1;
              const dotClass = isAutoClosed(r)
                ? "bg-ff-textMuted/40 ring-ff-textMuted/40"
                : r.status === "approved"
                ? "bg-ff-success ring-ff-success"
                : r.status === "rejected"
                ? "bg-ff-danger ring-ff-danger"
                : "bg-ff-warning ring-ff-warning";
              const notePillClass =
                r.status === "approved"
                  ? "border-l-ff-success"
                  : r.status === "rejected"
                  ? "border-l-ff-danger"
                  : "border-l-ff-warning";
              return (
                <div
                  key={r.id}
                  className={`relative animate-fade-in pl-7 ${isLastOverall ? "" : "pb-6"}`}
                  style={{ animationDelay: `${(stepIdx * 10 + rowIdx) * 70}ms`, animationFillMode: "backwards" }}
                >
                  {!isLastOverall && (
                    <div className="absolute left-[5px] top-[22px] bottom-0 w-0.5 bg-ff-border" />
                  )}
                  <span className={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 border-white ring-2 ${dotClass}`} />

                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ff-textMuted">
                      {r.versionLabel}
                    </span>
                    {r.event === "attempt" && (
                      <span className="text-[11px] text-ff-textMuted">Attempt {r.attemptNumber}</span>
                    )}
                    {r.event !== "attempt" && (
                      <span className="rounded-full bg-ff-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ff-accent">
                        {EVENT_TAG[r.event]}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-ff-text">{r.reviewer.name}</span>
                    {isAutoClosed(r) ? (
                      <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-[11px] font-medium text-ff-textMuted">
                        Not required
                      </span>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                          r.status === "approved"
                            ? "bg-ff-success/15 text-ff-success"
                            : r.status === "rejected"
                            ? "bg-ff-danger/15 text-ff-danger"
                            : "bg-ff-warning/15 text-ff-warning"
                        }`}
                      >
                        {r.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ff-textMuted">
                    assigned by {r.requestedBy.name}
                    {mounted && (
                      <>
                        {" "}
                        · {r.resolvedAt ? formatDateTime(r.resolvedAt) : `${formatDateTime(r.createdAt)} (pending)`}
                      </>
                    )}
                  </p>

                  {!isAutoClosed(r) && r.comments && (
                    <p className={`mt-2 rounded-ff border-l-[3px] bg-ff-lavender/40 px-3 py-2 text-sm text-ff-text ${notePillClass}`}>
                      {r.comments}
                    </p>
                  )}
                </div>
              );
              })}
            </div>
            );
          })}
        </div>
      )}
    </section>

    {commentRoundNumbers.length > 0 && (
      <section className="mb-6 overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
        <div className="flex items-start justify-between gap-3 border-b border-ff-border px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-ff-text">
              Document Comments
              <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-xs font-semibold text-ff-textMuted">
                {visibleComments.length}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-ff-textMuted">
              {onCommentClick
                ? "Select a comment to view it in context on the document."
                : "Feedback anchored to specific passages in the document."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCommentsCollapsed((c) => !c)}
            title={commentsCollapsed ? "Expand" : "Collapse"}
            aria-label={commentsCollapsed ? "Expand" : "Collapse"}
            aria-expanded={!commentsCollapsed}
            className="shrink-0 rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
          >
            {commentsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {!commentsCollapsed && (
        <>
        <div className="flex flex-wrap items-center gap-3 border-b border-ff-border bg-ff-lavender/30 px-4 py-2.5">
          {commentRoundNumbers.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm">
              <span className="text-xs font-medium text-ff-textMuted">Round</span>
              <select
                value={selectedRound ?? ""}
                onChange={(e) => {
                  const round = Number(e.target.value);
                  const group = roundGroups.find((g) => g.round === round);
                  const attempts = (group?.attempts ?? []).filter((a) => commentAttemptKeys.has(`${round}.${a.attempt}`));
                  const attempt = attempts[attempts.length - 1]?.attempt ?? 0;
                  onActiveCommentChange({ round, attempt });
                }}
                className="rounded-ff border border-ff-border bg-white px-2 py-1 text-sm text-ff-text focus:border-ff-accent focus:outline-none focus:ring-2 focus:ring-ff-accent/20"
              >
                {commentRoundNumbers.map((n) => {
                  // "(Current)" on its own reads as "this round's outcome
                  // is the document's current state" — misleading for a
                  // round that's actually still awaiting a decision. Name
                  // the real status instead so a round still in review
                  // never looks like it's already been decided.
                  const tag =
                    n !== currentGroup?.round
                      ? ""
                      : stageByRound.get(n) === "current"
                      ? " (Pending Review)"
                      : " (Latest)";
                  return (
                    <option key={n} value={n}>
                      Round {n}
                      {tag}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          {/* Every version (attempt) that has comments within the selected
              round, all shown at once as tabs — unlike the Round selector
              above, this isn't a dropdown: a round usually only has a
              couple of attempts, and seeing them all side by side (rather
              than one at a time behind a closed list) makes it obvious
              there's more than one to check. A vertical divider (rather than
              just a gap) marks it as a second, related-but-distinct control
              next to Round, not a continuation of the same one. */}
          {attemptsForSelectedRound.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-l border-ff-border pl-3">
              {attemptsForSelectedRound.map((a) => {
                const isActive = a.attempt === selectedAttempt;
                return (
                  <button
                    key={a.attempt}
                    type="button"
                    onClick={() => selectedRound !== null && onActiveCommentChange({ round: selectedRound, attempt: a.attempt })}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? "border-ff-accent bg-white text-ff-accent shadow-ff"
                        : "border-transparent bg-white/60 text-ff-textMuted hover:border-ff-accent/40 hover:text-ff-accent"
                    }`}
                  >
                    {a.label}
                    {currentGroup && currentAttempt && a.attempt === currentAttempt.attempt && selectedRound === currentGroup.round && (
                      <span className="ml-1 text-ff-warning">•</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4">
          {selectedRoundComments.length > 0 ? (
            <>
              <p className="mb-2.5 text-xs font-medium text-ff-textMuted">
                {selectedRoundComments.length} comment{selectedRoundComments.length === 1 ? "" : "s"} · {selectedLabel}
              </p>
              <CommentList comments={selectedRoundComments} reviewerNameByRequestId={reviewerNameByRequestId} onCommentClick={onCommentClick} />
            </>
          ) : (
            <p className="rounded-ff border border-dashed border-ff-border p-4 text-center text-xs text-ff-textMuted">
              {/* "Yet" only reads right while this specific attempt is still
                  actually open for comments — the current one, on a document
                  still mid-review. Once it's resolved (approved/rejected) or
                  the document has moved past review entirely, nothing more
                  is coming for it, so the wording shouldn't imply otherwise. */}
              {documentStatus === "pending_review" &&
              currentGroup &&
              currentAttempt &&
              selectedRound === currentGroup.round &&
              selectedAttempt === currentAttempt.attempt
                ? `No Comments for this Version yet.`
                : `No Comments for this Version.`}
            </p>
          )}
        </div>

        {documentViewer && <div className="border-t border-ff-border p-4">{documentViewer}</div>}
        </>
        )}
      </section>
    )}
    </>
  );
}

// First two initials of a name, for the small avatar chip next to each
// reviewer group below — e.g. "Test Manager" -> "TM".
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Extracted so the "Comments on the Document" section can render an
 * older-attempts group and the newest-attempt group as two separate lists
 * without duplicating this markup. Groups by reviewer (in order of first
 * appearance) rather than one flat interleaved list — the attempt is
 * already the tab you're looking at, so what's left to distinguish within
 * it is *who* said what, which matters once an attempt has more than one
 * reviewer (add-reviewers / second opinion). This is only ever inline
 * (highlight-and-comment) review feedback — open Feedback (components/
 * DocumentFeedback.tsx) is a separate model with its own section elsewhere
 * on the page, never merged in here. */
function CommentList({
  comments,
  reviewerNameByRequestId,
  onCommentClick,
}: {
  comments: InlineCommentRow[];
  reviewerNameByRequestId: Record<string, string>;
  onCommentClick?: (commentId: string) => void;
}) {
  const reviewerOrder: string[] = [];
  const byReviewer = new Map<string, InlineCommentRow[]>();
  for (const c of comments) {
    const name = reviewerNameByRequestId[c.reviewRequestId] ?? "Reviewer";
    if (!byReviewer.has(name)) {
      byReviewer.set(name, []);
      reviewerOrder.push(name);
    }
    byReviewer.get(name)!.push(c);
  }

  return (
    <div className="space-y-4">
      {reviewerOrder.map((name, gi) => {
        const items = byReviewer.get(name)!;
        return (
          <div
            key={name}
            className="animate-fade-in"
            style={{ animationDelay: `${gi * 60}ms`, animationFillMode: "backwards" }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ff-accent/10 text-[11px] font-bold text-ff-accent">
                {initials(name)}
              </span>
              <span className="text-sm font-semibold text-ff-text">{name}</span>
              <span className="text-xs text-ff-textMuted">
                {items.length} comment{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="ml-3 space-y-2 border-l-2 border-ff-border pl-4">
              {items.map((c) => {
                // Highlighted excerpt and the comment it's about are kept
                // as one visibly connected unit (the quote's own tinted
                // block, feeding directly into the comment right below it)
                // rather than a quote line floating loosely above plain
                // text — the pairing should be obvious without having to
                // infer it from proximity alone.
                const body = (
                  <>
                    {c.highlightedText && (
                      <div className="mb-1.5 rounded-sm border-l-[3px] border-[#00994D] bg-[#00994D]/10 px-2 py-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[#00994D]">Highlighted</p>
                        <p className="mt-0.5 text-xs italic text-ff-text">&ldquo;{c.highlightedText}&rdquo;</p>
                      </div>
                    )}
                    <p className={`text-sm text-ff-text ${c.highlightedText ? "pl-0.5" : ""}`}>{c.comment}</p>
                  </>
                );
                return (
                  <li key={c.id} className="rounded-ff border border-ff-border bg-white">
                    {onCommentClick ? (
                      <button
                        type="button"
                        onClick={() => onCommentClick(c.id)}
                        className="w-full rounded-ff p-2.5 text-left transition-colors hover:bg-ff-lavender/40"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="rounded-ff p-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
