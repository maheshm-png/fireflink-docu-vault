// Computes a "Round.Attempt" DISPLAY label for each document version —
// v1.0, v1.1, v2.0 — instead of the raw incrementing DocumentVersion.
// versionNumber (v1, v2, v3). Purely a display-layer computation: nothing
// here changes how versions/rounds are actually created or stored.
//
// Why this exists: a rejected-then-replaced upload and a revoked-then-
// replaced upload both look identical in the raw data (a new
// DocumentVersion + a new ReviewRequest.roundNumber, created together by
// app/api/documents/[id]/versions/route.ts) — but they should read
// differently. A plain reject-and-resubmit is another ATTEMPT at the SAME
// round (v1.0 rejected -> v1.1 approved, still "Round 1"); only a revoke
// (app/api/documents/[id]/revoke/route.ts, which bumps roundNumber WITHOUT
// creating a new version) starts a genuinely new ROUND. There's also a
// third case with no new version at all — "add-reviewers" / second opinion
// (app/api/documents/[id]/review/route.ts) bumps roundNumber too, purely to
// add a parallel reviewer to the SAME attempt.
//
// The revoke boundary is read from Document.revokedAt, the same single
// latest-revoke timestamp app/dashboard/documents/[id]/ReviewTrail.tsx
// already uses for its own before/after-revoke split — reused here rather
// than reinvented. Known limitation: revokedAt only ever holds the LATEST
// revoke (no historical revoke log), so a document revoked more than once
// only gets correct round boundaries for the most recent revoke cycle —
// same limitation ReviewTrail.tsx's existing split already has.

type VersionRef = { id: string; versionNumber: number; uploadedAt: Date };
type ReviewRequestRef = { roundNumber: number; status: string; comments: string | null; createdAt: Date };

// A version and its paired round are always created in the same request
// handler (versions/route.ts creates the DocumentVersion, then immediately
// the new-round ReviewRequest rows) — their timestamps land within
// milliseconds of each other. A generous window still comfortably rules out
// any OTHER round (a recheck/second-opinion round, created in a completely
// separate request potentially hours/days later) from being mistaken for
// "this round got a new version."
const VERSION_MATCH_WINDOW_MS = 60_000;

export type RoundAttemptEvent = "attempt" | "recheck" | "second-opinion";

export type RoundAttemptEntry = {
  round: number;
  attempt: number;
  label: string; // "v{round}.{attempt}"
  versionId: string;
  versionNumber: number;
  event: RoundAttemptEvent;
};

export type RoundGroupAttempt = {
  attempt: number;
  label: string;
  versionId: string;
  versionNumber: number;
  // Every ReviewRequest.roundNumber that maps to this attempt — usually
  // just one, but a second-opinion or recheck round folds in here too
  // (same version, no round/attempt bump), each with its own event tag.
  rounds: { roundNumber: number; event: RoundAttemptEvent }[];
};

export type RoundGroup = { round: number; attempts: RoundGroupAttempt[] };

export type RoundAttemptResult = {
  byVersionId: Map<string, { round: number; attempt: number; label: string }>;
  byRoundNumber: Map<number, RoundAttemptEntry>;
  groups: RoundGroup[];
};

/** The one place that decides "which round reviewed which version, and
 * what Round.Attempt label does that version get" — see this file's own
 * header comment for the reasoning. Everything else (publish-eligibility
 * checks, the Versions table, version pickers, the review stepper, etc.)
 * should read its answer from here rather than re-deriving its own
 * round<->version guess — two call sites used to do exactly that with
 * simple array-position math that silently broke once a revoke had
 * happened (rounds can outnumber versions): app/api/documents/[id]/review/
 * route.ts's old `sortedVersions[myRequest.roundNumber - 1]`, and
 * app/dashboard/documents/[id]/ReviewTrailWithHighlights.tsx's old
 * `versionByRound` array-zip. */
export function computeRoundAttempts(
  versions: VersionRef[],
  reviewRequests: ReviewRequestRef[],
  revokedAt: Date | null
): RoundAttemptResult {
  const byRoundNumber = new Map<number, RoundAttemptEntry>();
  const byVersionId = new Map<string, { round: number; attempt: number; label: string }>();

  const sortedVersions = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const roundNumbers = [...new Set(reviewRequests.map((r) => r.roundNumber))].sort((a, b) => a - b);

  if (roundNumbers.length === 0 || sortedVersions.length === 0) {
    return { byVersionId, byRoundNumber, groups: [] };
  }

  const earliestCreatedAt = (n: number) =>
    Math.min(...reviewRequests.filter((r) => r.roundNumber === n).map((r) => r.createdAt.getTime()));

  // Round 1 always reviews versions[0] — true by construction, a document
  // is always created with v1 and round 1 together.
  let currentVersion = sortedVersions[0];
  let nextVersionIdx = 1;
  let round = 1;
  let attempt = 0;
  // Latches true the first time a round's earliest row lands at/after the
  // revoke timestamp, and stays true — "we're now past that revoke."
  let crossedRevoke = false;
  // True once the round bump for the CURRENT revoke has actually happened
  // (the first new-version round after crossing) — guards against bumping
  // round a second time for a later recheck/second-opinion round that
  // crossed the same boundary but brought no new version.
  let roundBumpedForThisRevoke = false;

  roundNumbers.forEach((n, i) => {
    let event: RoundAttemptEvent = "attempt";

    if (i > 0) {
      const earliest = earliestCreatedAt(n);
      if (revokedAt !== null && !crossedRevoke && earliest >= revokedAt.getTime()) {
        crossedRevoke = true;
      }

      const candidate = sortedVersions[nextVersionIdx];
      const gotNewVersion = candidate !== undefined && Math.abs(candidate.uploadedAt.getTime() - earliest) < VERSION_MATCH_WINDOW_MS;

      if (gotNewVersion) {
        currentVersion = candidate;
        nextVersionIdx += 1;

        // Was the round immediately before this one (the last decision made
        // on the version this upload replaces) a full approval? Replacing a
        // version that was actually approved/published means whatever comes
        // next is a fresh review cycle, not a continuation of the old one —
        // a revoke is one way to reach that (handled below), but simply
        // uploading a new version onto an already-published document is
        // another, and both should read as a new ROUND the same way. Only a
        // version that got REJECTED (or is still mid-review) keeps its
        // resubmission in the SAME round, as the next ATTEMPT.
        const previousRoundNumber = roundNumbers[i - 1];
        const previousRows = reviewRequests.filter((r) => r.roundNumber === previousRoundNumber);
        const previousRoundApproved = previousRows.length > 0 && previousRows.every((r) => r.status === "approved");

        if (previousRoundApproved || (crossedRevoke && !roundBumpedForThisRevoke)) {
          round += 1;
          attempt = 0;
          roundBumpedForThisRevoke = true;
        } else {
          attempt += 1;
        }
        event = "attempt";
      } else {
        event = crossedRevoke ? "recheck" : "second-opinion";
      }
    }

    const label = `v${round}.${attempt}`;
    byRoundNumber.set(n, {
      round,
      attempt,
      label,
      versionId: currentVersion.id,
      versionNumber: currentVersion.versionNumber,
      event,
    });
    if (!byVersionId.has(currentVersion.id)) {
      byVersionId.set(currentVersion.id, { round, attempt, label });
    }
  });

  const groupByRound = new Map<number, RoundGroup>();
  const attemptIndexByKey = new Map<string, number>();
  for (const n of roundNumbers) {
    const entry = byRoundNumber.get(n)!;
    let group = groupByRound.get(entry.round);
    if (!group) {
      group = { round: entry.round, attempts: [] };
      groupByRound.set(entry.round, group);
    }
    const key = `${entry.round}.${entry.attempt}`;
    let idx = attemptIndexByKey.get(key);
    if (idx === undefined) {
      idx = group.attempts.length;
      group.attempts.push({
        attempt: entry.attempt,
        label: entry.label,
        versionId: entry.versionId,
        versionNumber: entry.versionNumber,
        rounds: [],
      });
      attemptIndexByKey.set(key, idx);
    }
    group.attempts[idx].rounds.push({ roundNumber: n, event: entry.event });
  }

  const groups = [...groupByRound.values()].sort((a, b) => a.round - b.round);
  for (const g of groups) g.attempts.sort((a, b) => a.attempt - b.attempt);

  return { byVersionId, byRoundNumber, groups };
}

/** The set of version ids that were genuinely published at some point —
 * i.e. every reviewer's row in at least one of the ReviewRequest rounds
 * mapped to that version (there can be more than one: the original
 * approval, plus a later recheck) resolved "approved". An auto-closed row
 * is always status "rejected" (see app/api/documents/[id]/review/route.ts's
 * reject handling), so it already fails this check on its own — no
 * separate exclusion needed. */
export function everApprovedVersionIds(
  versions: VersionRef[],
  reviewRequests: ReviewRequestRef[],
  revokedAt: Date | null
): Set<string> {
  const { byRoundNumber } = computeRoundAttempts(versions, reviewRequests, revokedAt);
  const roundsByVersion = new Map<string, number[]>();
  for (const [roundNumber, entry] of byRoundNumber) {
    if (!roundsByVersion.has(entry.versionId)) roundsByVersion.set(entry.versionId, []);
    roundsByVersion.get(entry.versionId)!.push(roundNumber);
  }

  const approved = new Set<string>();
  for (const [versionId, roundNums] of roundsByVersion) {
    const everFullyApproved = roundNums.some((rn) => {
      const rows = reviewRequests.filter((r) => r.roundNumber === rn);
      return rows.length > 0 && rows.every((r) => r.status === "approved");
    });
    if (everFullyApproved) approved.add(versionId);
  }
  return approved;
}
