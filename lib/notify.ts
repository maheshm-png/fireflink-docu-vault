import { notifyGChat, notifyGChatManager } from "./gchat";
import { createNotifications } from "./notifications";
import { sendEmail } from "./email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Every API route that triggers a notification (upload, approve/reject,
 * reassign, feedback tagged/accepted, revoke, invite) already has its real
 * work — the DB writes the response actually reports on — fully committed
 * by the time it calls one of the functions below. Chat/email delivery
 * itself is already fire-and-forget-safe (notifyGChat/notifyGChatManager
 * and sendEmail swallow their own errors, see lib/gchat.ts and
 * lib/email.ts), so there's nothing
 * left for the caller to `await` except a slow or unreachable SMTP/Chat
 * round-trip — which would otherwise sit directly in the user's request,
 * making an upload or approval feel hung (or genuinely take 20s+) for a
 * notification the user isn't even looking at yet. Callers pass the
 * notify*() call in UNAWAITED (`fireNotification(notifyXxx(...))`) so the
 * route can respond the moment its own work is done; this just catches
 * whatever error handling inside notify*() didn't (a bug, not the normal
 * path) so it never becomes an unhandled rejection.
 */
export function fireNotification(promise: Promise<unknown>) {
  promise.catch((err) => console.error("Notification failed:", err));
}

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
// reviewer's comments (required on reject, see ReviewActions.tsx), plus any
// inline (highlight-and-comment) feedback left during this same review
// round — see components/InlineCommentReview.tsx and
// app/api/documents/[id]/review/route.ts, which fetches that round's
// InlineComment rows and passes them here. Deliberately batched into this
// one decision-time notice rather than sent as they're added.
export async function notifyReviewDecision(params: {
  uploaderId: string;
  uploaderName: string;
  uploaderEmail: string;
  documentTitle: string;
  documentId: string;
  decision: "approved" | "rejected";
  comments?: string;
  inlineComments?: { highlightedText: string | null; comment: string }[];
}) {
  const verb = params.decision === "approved" ? "was approved and is now live" : "was sent back with feedback";
  const lines = [
    `${params.uploaderName}'s submission "${params.documentTitle}" ${verb}.`,
  ];
  if (params.comments) lines.push(`Reviewer comments: ${params.comments}`);
  if (params.inlineComments && params.inlineComments.length > 0) {
    lines.push("", "Inline comments:");
    lines.push(
      ...params.inlineComments.map((c) =>
        c.highlightedText ? `- On "${c.highlightedText}": ${c.comment}` : `- ${c.comment}`
      )
    );
  }
  lines.push(`View: ${APP_URL}/dashboard/documents/${params.documentId}`);
  await notifyGChat(lines.join("\n"));

  // The in-app bell entry this was previously missing entirely — a
  // contributor whose upload was approved or rejected got an email and a
  // team-wide GChat mention, but nothing in their own notification tab.
  await createNotifications([
    {
      userId: params.uploaderId,
      type: params.decision,
      title:
        params.decision === "approved"
          ? `Approved and published: ${params.documentTitle}`
          : `Sent back with feedback: ${params.documentTitle}`,
      body: params.comments,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);

  const decisionText =
    params.decision === "approved" ? "has been approved and is now published" : "has been returned for revision";
  const inlineCommentsHtml =
    params.inlineComments && params.inlineComments.length > 0
      ? `
        <p><strong>Inline Comments:</strong></p>
        <ul>
          ${params.inlineComments
            .map((c) => (c.highlightedText ? `<li>On "${c.highlightedText}": ${c.comment}</li>` : `<li>${c.comment}</li>`))
            .join("")}
        </ul>
      `
      : "";
  await sendEmail({
    to: params.uploaderEmail,
    subject: `Document ${params.decision}: ${params.documentTitle}`,
    html: `
      <p>Dear ${params.uploaderName},</p>
      <p>Your submission, "<strong>${params.documentTitle}</strong>," ${decisionText}.</p>
      ${params.comments ? `<p><strong>Reviewer Comments:</strong> ${params.comments}</p>` : ""}
      ${inlineCommentsHtml}
      <p>You may view the document using the link below.</p>
      <p><a href="${APP_URL}/dashboard/documents/${params.documentId}">View Document</a></p>
    `,
  });
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
  // A pre-computed "v1.1"-style Round.Attempt label (lib/versionRounds.ts),
  // not a raw versionNumber — the caller already has versions+
  // reviewRequests loaded to compute it, so this stays a plain string here.
  versionLabel?: string;
  recipients: { id: string; name: string }[];
}) {
  const versionSuffix = params.versionLabel ? ` (${params.versionLabel})` : "";
  await notifyGChat(
    `Document revoked: "${params.documentTitle}${versionSuffix}". Please do not use this document, if you have already downloaded a copy, discontinue its use immediately.`
  );
  await createNotifications(
    params.recipients.map((r) => ({
      userId: r.id,
      type: "revoked" as const,
      title: `Document revoked: ${params.documentTitle}${versionSuffix}`,
      body: "Please don't use this document, discontinue use of any copy you've already downloaded.",
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
  reviewerEmail: string;
  isNewVersion: boolean;
  // See notifyDocumentRevoked's own comment — a pre-computed label, not a
  // raw versionNumber.
  versionLabel?: string;
}) {
  const submissionType = params.isNewVersion
    ? `A new version (${params.versionLabel})`
    : "A new document";
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
        ? `New version to review: ${params.documentTitle} (${params.versionLabel})`
        : `New document to review: ${params.documentTitle}`,
      body: `Submitted by ${params.uploaderName}`,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);

  await sendEmail({
    to: params.reviewerEmail,
    subject: `Review Required: ${params.documentTitle}`,
    html: `
      <p>Dear ${params.reviewerName},</p>
      <p>${submissionType} has been submitted and requires your review.</p>
      <p>
        <strong>Title:</strong> ${params.documentTitle}<br/>
        <strong>Category:</strong> ${params.categoryName}<br/>
        <strong>Submitted By:</strong> ${params.uploaderName}
      </p>
      <p>Please review the submission using the link below.</p>
      <p><a href="${APP_URL}/dashboard/documents/${params.documentId}">Review Document</a></p>
    `,
  });
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

/**
 * Emailed to everyone who previously downloaded ANY earlier version of this
 * document — they have a stale copy sitting on their machine and have no
 * other way of knowing a newer one just went live (unlike the in-app bell,
 * which only reaches people still visiting the site). Fires on every
 * approval alongside notifyReviewDecision/notifyDocumentPublished above,
 * regardless of the manager's announceToAll choice — this is a targeted
 * courtesy to people who already have a copy, not a broadcast decision.
 * Naturally no-ops for a document's first-ever publish, since there's
 * nobody to have downloaded a "previous" version of it yet.
 */
export async function notifyNewVersionAvailable(params: {
  documentTitle: string;
  documentId: string;
  // See notifyDocumentRevoked's own comment — a pre-computed label, not a
  // raw versionNumber.
  versionLabel: string;
  recipients: { email: string; name: string }[];
}) {
  await Promise.all(
    params.recipients.map((r) =>
      sendEmail({
        to: r.email,
        subject: `New Version Available: ${params.documentTitle}`,
        html: `
          <p>Dear ${r.name},</p>
          <p>A new version (${params.versionLabel}) of "<strong>${params.documentTitle}</strong>" is now available. Please note that the copy you previously downloaded may no longer be current.</p>
          <p>We recommend downloading the latest version at your earliest convenience.</p>
          <p><a href="${APP_URL}/dashboard/documents/${params.documentId}">View Latest Version</a></p>
        `,
      })
    )
  );
}

export async function notifyManagerRetentionAlert(params: {
  purgedDeletedDocs: { title: string }[];
  // versionLabel: see notifyDocumentRevoked's own comment — a pre-computed
  // label, not a raw versionNumber.
  purgedVersions: { documentTitle: string; versionLabel: string }[];
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
    lines.push(...params.purgedVersions.map((v) => `- ${v.documentTitle} (${v.versionLabel})`));
  }
  await notifyGChatManager(lines.join("\n"));
}

// A manager or the document's own uploader accepted a piece of feedback
// (app/api/documents/[id]/feedback/[feedbackId]/route.ts's status handling,
// FeedbackManagement.tsx) — tells the person who originally left it that
// their input was acted on. In-app bell only, not the team-wide GChat space
// or email: this is a per-comment courtesy to one specific person, not a
// document-lifecycle event on the narrow list this file's header comment
// describes.
export async function notifyFeedbackAccepted(params: {
  documentTitle: string;
  documentId: string;
  authorId: string;
  acceptedByName: string;
  // Optional reply left alongside the accept decision — see
  // DocumentFeedback.responseNote's own schema comment.
  responseNote?: string | null;
}) {
  await createNotifications([
    {
      userId: params.authorId,
      type: "feedback_accepted",
      title: `Your feedback was accepted: ${params.documentTitle}`,
      body: params.responseNote
        ? `${params.acceptedByName}: ${params.responseNote}`
        : `${params.acceptedByName} accepted your feedback.`,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);
}

// Someone left feedback and tagged a specific person already involved with
// the document — its contributor, or one of its reviewers (see
// components/DocumentFeedback.tsx's tag picker and app/api/documents/[id]/
// feedback/route.ts's own validation that the tag target is actually one of
// those two things, not an arbitrary user). Same in-app-only scope as
// notifyFeedbackAccepted above — a courtesy ping to one person, not a
// document-lifecycle event.
export async function notifyFeedbackTagged(params: {
  documentTitle: string;
  documentId: string;
  taggedUserId: string;
  authorName: string;
  comment: string;
}) {
  await createNotifications([
    {
      userId: params.taggedUserId,
      type: "feedback_tagged",
      title: `${params.authorName} tagged you in feedback: ${params.documentTitle}`,
      body: params.comment,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
    },
  ]);
}
