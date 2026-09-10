"use client";

import { Fragment, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDate";

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
  tooltip: string;
  rows?: ReviewRequestRow[];
};

/** Delivery-tracker-style horizontal step bar (Uploaded → Round 1 → ... →
 * Published/Rejected[/Revoked → Round N ...]) for a document's review
 * history — same idea as an Amazon order tracker. Rounds are placed
 * chronologically: any round created after a revoke shows up after the
 * Revoked step rather than before Published, since that's when it actually
 * happened (a re-review triggered by the revoke, not part of the original
 * approval that led to the first publish). See app/api/documents/[id]/
 * review/route.ts's roundNumber comment for what a "round" means; this is a
 * visual read of that same data, not a separate source of truth. */
export default function ReviewTrail({
  documentStatus,
  uploadedByName,
  uploadedAt,
  reviewRequests,
  inlineComments,
  revoked,
  onCommentClick,
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
  // When provided, each inline comment row becomes clickable — see
  // components/ReviewTrailWithHighlights.tsx, which wires this to
  // components/ReviewHighlightsViewer.tsx so clicking a comment jumps to
  // and flashes it on the actual rendered document. Omitted (rows render
  // as plain text) wherever that document view isn't also on the page.
  onCommentClick?: (commentId: string) => void;
}) {
  // formatDateTime uses toLocaleString, which resolves to the server's
  // timezone (UTC in production) during the initial server-rendered pass —
  // wrong for anyone not in UTC. Gating it behind `mounted` means the first
  // client render matches that same (date-less) server output, avoiding a
  // hydration mismatch, then fills in the viewer's actual local time right
  // after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const allRounds = [...new Set(reviewRequests.map((r) => r.roundNumber))].sort((a, b) => a - b);

  // A round "happened after" the revoke if its earliest row was created at
  // or after the revoke timestamp — that's the re-review round, not one of
  // the rounds that led to the original publish.
  const roundEarliestCreatedAt = (n: number) =>
    Math.min(...reviewRequests.filter((r) => r.roundNumber === n).map((r) => r.createdAt.getTime()));
  const roundsBeforeRevoke = revoked
    ? allRounds.filter((n) => roundEarliestCreatedAt(n) < revoked.at.getTime())
    : allRounds;
  const roundsAfterRevoke = revoked ? allRounds.filter((n) => !roundsBeforeRevoke.includes(n)) : [];

  function roundStage(n: number): Stage {
    const rows = reviewRequests.filter((r) => r.roundNumber === n);
    if (rows.some((r) => r.status === "rejected" && !isAutoClosed(r))) return "rejected";
    if (rows.length > 0 && rows.every((r) => r.status === "approved")) return "done";
    // Every row in this round got auto-closed by a rejection elsewhere —
    // nobody assigned here ever actually got to decide.
    if (rows.length > 0 && rows.every((r) => isAutoClosed(r))) return "closed";
    return "current";
  }

  function roundStep(n: number): Step {
    const stage = roundStage(n);
    return {
      key: `round-${n}`,
      stage,
      label: `Round ${n}`,
      tooltip: `Round ${n} review${
        stage === "current" ? " — in progress" : stage === "rejected" ? " — rejected" : stage === "closed" ? " — closed" : ""
      }`,
      rows: reviewRequests.filter((r) => r.roundNumber === n),
    };
  }

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
    ...roundsBeforeRevoke.map(roundStep),
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
    ...roundsAfterRevoke.map(roundStep),
  ];

  const roundSteps = steps.filter((s) => s.rows && s.rows.length > 0);

  // A flat list of every resolved round's inline (highlight-and-comment)
  // feedback, decoupled from the decision timeline below — mixing "who
  // decided what" with "comments on specific passages" into one card was
  // the actual source of confusion this component used to have. Each
  // comment is labeled with its own round/reviewer rather than nested
  // under a round block, so it reads as a standalone annotation list (see
  // components/ReviewHighlightsViewer.tsx, which this list drives via
  // onCommentClick — clicking a row jumps to and flashes it there).
  const reviewerNameByRequestId = Object.fromEntries(reviewRequests.map((r) => [r.id, r.reviewer.name]));
  const roundNumberByRequestId = Object.fromEntries(reviewRequests.map((r) => [r.id, r.roundNumber]));
  const resolvedRequestIds = new Set(reviewRequests.filter((r) => r.status !== "pending").map((r) => r.id));
  const visibleComments = (inlineComments ?? []).filter((c) => resolvedRequestIds.has(c.reviewRequestId));

  return (
    <>
    <section className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
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
            <div className="flex shrink-0 flex-col items-center px-0.5" title={step.tooltip}>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${DOT_STYLE[step.stage]}`}
              >
                {step.stage === "done"
                  ? "✓"
                  : step.stage === "rejected"
                  ? "✕"
                  : step.stage === "closed"
                  ? "–"
                  : step.stage === "revoked"
                  ? "↩"
                  : step.key.startsWith("round-")
                  ? step.label.replace("Round ", "")
                  : ""}
              </span>
              <p
                className={`mt-1 max-w-[72px] text-center text-[11px] leading-tight ${
                  step.stage === "upcoming" || step.stage === "closed" ? "text-ff-textMuted" : "text-ff-text"
                }`}
              >
                {step.label}
              </p>
            </div>
          </Fragment>
        ))}
      </div>

      {roundSteps.length > 0 && (
        <div className="mt-4 border-t border-ff-border pt-4">
          {roundSteps.map((step, stepIdx) =>
            step.rows!.map((r, rowIdx) => {
              const isLastOverall =
                stepIdx === roundSteps.length - 1 && rowIdx === step.rows!.length - 1;
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
                  style={{ animationDelay: `${stepIdx * 70}ms`, animationFillMode: "backwards" }}
                >
                  {!isLastOverall && (
                    <div className="absolute left-[5px] top-[22px] bottom-0 w-0.5 bg-ff-border" />
                  )}
                  <span className={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 border-white ring-2 ${dotClass}`} />

                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ff-textMuted">
                      {step.label}
                    </span>
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
                    {mounted && r.resolvedAt && <> · {formatDateTime(r.resolvedAt)}</>}
                  </p>

                  {!isAutoClosed(r) && r.comments && (
                    <p className={`mt-2 rounded-ff border-l-[3px] bg-ff-lavender/40 px-3 py-2 text-sm text-ff-text ${notePillClass}`}>
                      {r.comments}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>

    {visibleComments.length > 0 && (
      <section className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <h2 className="mb-1 text-base font-bold text-ff-text">
          Comments on the Document
          <span className="ml-2 rounded-full bg-ff-lavender px-2 py-0.5 text-xs font-semibold text-ff-textMuted">
            {visibleComments.length}
          </span>
        </h2>
        <p className="mb-3 text-xs text-ff-textMuted">
          {onCommentClick ? "Click a comment to jump to it on the document." : "Feedback tied to specific passages."}
        </p>
        <ul className="space-y-2">
          {visibleComments.map((c, i) => {
            const body = (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-ff-text">{reviewerNameByRequestId[c.reviewRequestId] ?? "Reviewer"}</span>
                  <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-[10px] font-bold text-ff-textMuted">
                    Round {roundNumberByRequestId[c.reviewRequestId] ?? "?"}
                  </span>
                </div>
                {c.highlightedText && (
                  <p className="mt-1.5 inline-block max-w-full truncate rounded-sm bg-amber-200/40 px-1.5 py-0.5 text-xs italic text-ff-text">
                    &ldquo;{c.highlightedText}&rdquo;
                  </p>
                )}
                <p className="mt-1.5 text-sm text-ff-text">{c.comment}</p>
              </>
            );
            return (
              <li key={c.id} className="animate-fade-in" style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}>
                {onCommentClick ? (
                  <button
                    type="button"
                    onClick={() => onCommentClick(c.id)}
                    className="w-full rounded-ff border border-ff-border bg-white px-3 py-2.5 text-left transition-colors hover:border-ff-accent hover:bg-ff-lavender/40"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="rounded-ff border border-ff-border bg-white px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    )}
    </>
  );
}
