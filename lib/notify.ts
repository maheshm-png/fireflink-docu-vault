import { notifyGChat, notifyGChatManager } from "./gchat";
import { createNotifications } from "./notifications";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Notification policy (deliberately narrow): only three events reach the
 * team-wide Google Chat space —
 *   1. A document is published (notifyDocumentPublished)
 *   2. A document is flagged as outdated and needs a manager's review
 *      (notifyDocumentFlaggedStale)
 *   3. A document is revoked (notifyDocumentRevoked)
 * Routine per-step status (a fresh upload awaiting its first review, a new
 * version awaiting re-review) intentionally sends nothing — reviewers check
 * the Pending Review page instead — so the shared channel stays low-noise.
 * notifyReviewDecision below is the one exception admitted into that same
 * team-wide space anyway: Google Chat webhooks can only post to a shared
 * space, not DM a single person, so there's no private-channel equivalent
 * of the old one-to-one email — a rejection's reviewer comments are
 * visible team-wide same as everything else here.
 */

// Tells the whole team a submission was approved or rejected — carries the
// reviewer's comments (required on reject, see ReviewActions.tsx).
export async function notifyReviewDecision(params: {
  uploaderName: string;
  documentTitle: string;
  documentId: string;
  decision: "approved" | "rejected";
  comments?: string;
}) {
  const verb = params.decision === "approved" ? "was approved and is now live" : "was sent back with feedback";
  const lines = [
    `${params.uploaderName}'s submission "${params.documentTitle}" ${verb}.`,
  ];
  if (params.comments) lines.push(`Reviewer comments: ${params.comments}`);
  lines.push(`View: ${APP_URL}/dashboard/documents/${params.documentId}`);
  await notifyGChat(lines.join("\n"));
}

/**
 * The one notification a routine upload actually produces: it went live.
 * Broadcasts to the whole active team (the reviewer decides whether to send
 * this at all via the required "announce to all users" choice on approval —
 * see ReviewActions.tsx / app/api/documents/[id]/review/route.ts). The
 * Google Chat message names the uploader directly since a webhook posts to
 * one shared space rather than DMing people individually.
 */
export async function notifyDocumentPublished(params: {
  documentTitle: string;
  documentId: string;
  categoryName: string;
  uploaderName: string;
  recipients: { id: string; name: string }[];
}) {
  await notifyGChat(
    `New document published: "${params.documentTitle}" (${params.categoryName}), uploaded by ${params.uploaderName}. Please take a look.`
  );
  await createNotifications(
    params.recipients.map((r) => ({
      userId: r.id,
      type: "published" as const,
      title: `New in ${params.categoryName}: ${params.documentTitle}`,
      body: `Uploaded by ${params.uploaderName}`,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    }))
  );
}

/**
 * A document was just flagged as potentially outdated (see
 * scripts/run-staleness-check.ts) — tells the document's owner, who acts as
 * its reviewing manager, to take a look. The script only calls this when it
 * creates a *new* flag, not on every daily run while an existing one stays
 * unresolved, so this fires once per issue rather than repeating.
 */
export async function notifyDocumentFlaggedStale(params: {
  ownerName: string;
  documentTitle: string;
  documentId: string;
  reason: string;
}) {
  await notifyGChat(
    `"${params.documentTitle}" has been flagged as potentially outdated (${params.reason}). ${params.ownerName}, please review.`
  );
}

/**
 * A published document was pulled down by a manager. Broadcasts to the
 * whole active team — anyone may already have a copy — with a plain
 * instruction not to use it, rather than the re-approval mechanics underneath.
 */
export async function notifyDocumentRevoked(params: {
  documentTitle: string;
  documentId: string;
  versionNumber?: number;
  recipients: { id: string; name: string }[];
}) {
  const versionLabel = params.versionNumber ? ` (v${params.versionNumber})` : "";
  await notifyGChat(
    `Document revoked: "${params.documentTitle}${versionLabel}". Please do not use this document — if you have already downloaded a copy, discontinue its use immediately.`
  );
  await createNotifications(
    params.recipients.map((r) => ({
      userId: r.id,
      type: "revoked" as const,
      title: `Document revoked: ${params.documentTitle}${versionLabel}`,
      body: "Please don't use this document — discontinue use of any copy you've already downloaded.",
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    }))
  );
}

/** Weekly digest: pending reviews awaiting you + docs you own that are flagged stale. */
export async function notifyWeeklyDigest(params: {
  toName: string;
  pendingReviews: { title: string; documentId: string }[];
  staleDocs: { title: string; documentId: string; reason: string }[];
}) {
  if (params.pendingReviews.length === 0 && params.staleDocs.length === 0) return;

  await notifyGChat(
    `Weekly digest for ${params.toName}: ${params.pendingReviews.length} pending review(s), ${params.staleDocs.length} document(s) flagged as outdated.`
  );
}

/**
 * Manager-only action-item alerts — a separate Google Chat Space from the
 * whole-team one above (see lib/gchat.ts's notifyGChatManager). Two triggers:
 * a document landing in pending_review (new upload or new version) and an
 * automatic retention cleanup run. Nobody else receives these.
 */
export async function notifyManagerReviewNeeded(params: {
  documentTitle: string;
  documentId: string;
  categoryName: string;
  uploaderName: string;
  reviewerId: string;
  reviewerName: string;
  isNewVersion: boolean;
  versionNumber?: number;
}) {
  const submissionType = params.isNewVersion
    ? `New version submitted — v${params.versionNumber}`
    : "New document submitted";
  await notifyGChatManager(
    [
      "Action required: document pending review",
      "",
      submissionType,
      `Title: "${params.documentTitle}"`,
      `Category: ${params.categoryName}`,
      `Submitted by: ${params.uploaderName}`,
      `Assigned reviewer: ${params.reviewerName}`,
      "",
      `Review it: ${APP_URL}/dashboard/documents/${params.documentId}`,
    ].join("\n")
  );
  await createNotifications([
    {
      userId: params.reviewerId,
      type: "new_version",
      title: params.isNewVersion
        ? `New version to review: ${params.documentTitle} (v${params.versionNumber})`
        : `New document to review: ${params.documentTitle}`,
      body: `Submitted by ${params.uploaderName}`,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);
}

/**
 * A reviewer just handed their review to someone else — either directly
 * (reassign) or by pulling in an extra person for a second/third opinion
 * (add-reviewers) — see the "reassign" and "add-reviewers" actions in
 * app/api/documents/[id]/review/route.ts. Same two channels as a brand-new
 * review assignment (manager GChat space + in-app bell), just worded for
 * the hand-off case specifically.
 */
export async function notifyReviewerAssigned(params: {
  documentTitle: string;
  documentId: string;
  reviewerId: string;
  reviewerName: string;
  assignedByName: string;
  reason: "reassigned" | "second_opinion";
}) {
  const verb = params.reason === "reassigned" ? "reassigned this document to you" : "asked you for a second opinion on this document";
  await notifyGChatManager(
    [
      "Action required: document review",
      "",
      `${params.assignedByName} ${verb}.`,
      `Title: "${params.documentTitle}"`,
      "",
      `Review it: ${APP_URL}/dashboard/documents/${params.documentId}`,
    ].join("\n")
  );
  await createNotifications([
    {
      userId: params.reviewerId,
      type: "new_version",
      title:
        params.reason === "reassigned"
          ? `Reassigned to you: ${params.documentTitle}`
          : `Second opinion requested: ${params.documentTitle}`,
      body: `${params.assignedByName} ${verb}`,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);
}

export async function notifyManagerRetentionAlert(params: {
  purgedDeletedDocs: { title: string }[];
  purgedVersions: { documentTitle: string; versionNumber: number }[];
}) {
  if (params.purgedDeletedDocs.length === 0 && params.purgedVersions.length === 0) return;

  const lines = ["Automatic retention cleanup ran", ""];
  if (params.purgedDeletedDocs.length > 0) {
    lines.push(`Permanently removed ${params.purgedDeletedDocs.length} document(s) deleted more than 30 days ago:`);
    lines.push(...params.purgedDeletedDocs.map((d) => `- ${d.title}`));
    lines.push("");
  }
  if (params.purgedVersions.length > 0) {
    lines.push(`Removed ${params.purgedVersions.length} outdated file version(s) older than 1 year (superseded, not the current version):`);
    lines.push(...params.purgedVersions.map((v) => `- ${v.documentTitle} (v${v.versionNumber})`));
  }
  await notifyGChatManager(lines.join("\n"));
}
