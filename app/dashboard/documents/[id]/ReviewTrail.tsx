import { Fragment } from "react";
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

type Stage = "done" | "current" | "rejected" | "closed" | "revoked" | "upcoming";

const DOT_STYLE: Record<Stage, string> = {
  done: "bg-ff-success text-white",
  current: "bg-ff-warning text-white animate-pulse",
  rejected: "bg-ff-danger text-white",
  closed: "bg-ff-textMuted/30 text-ff-textMuted",
  revoked: "bg-ff-warning text-white",
  upcoming: "bg-ff-lavender text-ff-textMuted",
};

const STATUS_WORD_STYLE: Record<string, string> = {
  pending: "text-ff-warning",
  approved: "text-ff-success",
  rejected: "text-ff-danger",
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
  revoked,
}: {
  documentStatus: string;
  uploadedByName: string;
  uploadedAt: Date;
  reviewRequests: ReviewRequestRow[];
  // Only meaningful when documentStatus is "revoked" — a document has to
  // have been published before it can be revoked, so the trail shows
  // Published (done) followed by this extra step rather than replacing it.
  revoked?: { byName: string; at: Date; reason: string | null } | null;
}) {
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
      tooltip: `Uploaded by ${uploadedByName} · ${formatDateTime(uploadedAt)}`,
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
              revoked?.at ? formatDateTime(revoked.at) : null,
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

  return (
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
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${DOT_STYLE[step.stage]}`}
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
        <div className="mt-4 space-y-1 border-t border-ff-border pt-3">
          {roundSteps.map((step) =>
            step.rows!.map((r) => (
              <p key={r.id} className="text-xs text-ff-textMuted">
                <span className="mr-1.5 rounded-full bg-ff-lavender px-1.5 py-0.5 text-[10px] font-medium text-ff-text">
                  {step.label}
                </span>
                <span className="text-ff-text">{r.reviewer.name}</span>{" "}
                {isAutoClosed(r) ? (
                  <span className="text-ff-textMuted">not required (closed)</span>
                ) : (
                  <span className={`capitalize ${STATUS_WORD_STYLE[r.status] ?? ""}`}>{r.status}</span>
                )}
                {" · assigned by "}
                {r.requestedBy.name}
                {r.resolvedAt && ` · ${formatDateTime(r.resolvedAt)}`}
                {!isAutoClosed(r) && r.comments && <> — &ldquo;{r.comments}&rdquo;</>}
              </p>
            ))
          )}
        </div>
      )}
    </section>
  );
}
