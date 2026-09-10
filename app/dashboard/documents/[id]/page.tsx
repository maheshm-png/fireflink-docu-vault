import { redirect } from "next/navigation";
import Link from "next/link";
import { Info, MessagesSquare, MessageCircle, History, Settings } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import DocTypeIcon from "@/components/DocTypeIcon";
import { prisma } from "@/lib/prisma";
import ReviewActions from "./ReviewActions";
import UndoApprovalButton from "./UndoApprovalButton";
import ReviewTrailWithHighlights from "./ReviewTrailWithHighlights";
import VersionDiff from "./VersionDiff";
import VersionCompareFrame from "./VersionCompareFrame";
import EditDocumentForm from "./EditDocumentForm";
import UploadVersionForm from "./UploadVersionForm";
import RevokeButton from "./RevokeButton";
import DeleteButton from "./DeleteButton";
import ArchiveButton from "./ArchiveButton";
import RestoreButton from "@/app/admin/deleted/RestoreButton";
import LifecycleActions from "./LifecycleActions";
import SetCurrentVersionButton from "./SetCurrentVersionButton";
import CurrentVersionControl from "./CurrentVersionControl";
import DocumentDetailTabs, { type DetailTab } from "./DocumentDetailTabs";
import DocumentPreview from "@/components/DocumentPreview";
import DownloadMenu from "@/components/DownloadMenu";
import ShareModal from "@/components/ShareModal";
import InlineCommentReview from "@/components/InlineCommentReview";
import DocumentFeedback from "@/components/DocumentFeedback";
import { LocalDateTime } from "@/components/LocalDateTime";
import { computeReviewDueDate } from "@/lib/reviewDue";
import { getAppSettings } from "@/lib/settings";
import type { CategoryFormField } from "@/lib/formSchema";

export default async function DocumentDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      category: true,
      owner: true,
      uploadedBy: true,
      deletedBy: true,
      revokedBy: true,
      currentVersion: true,
      versions: { orderBy: { versionNumber: "desc" }, include: { uploadedBy: true } },
      stalenessFlags: { where: { resolved: false } },
      duplicateOf: true,
    },
  });

  // Deleted documents are only reachable by manager/superadmin (to decide
  // whether to restore them) — everyone else, including a direct link,
  // bounces to the dashboard as if the document doesn't exist.
  if (document.deletedAt && !can(user.role, "viewDeleted")) {
    redirect("/dashboard");
  }
  const isDeleted = Boolean(document.deletedAt);

  // Opening a document this user was notified about (the bell, and the
  // dashboard ticker's "New: ..." entries — see app/dashboard/page.tsx)
  // counts as having seen it, so it stops showing as unread/new anywhere
  // once they've actually looked at it, not just when they click through
  // the bell specifically.
  await prisma.notification.updateMany({
    where: { userId: user.id, documentId: document.id, type: "published", read: false },
    data: { read: true },
  });

  // The full review trail (every round, every reviewer, resolved or not) —
  // shown to anyone with a real stake in it (uploader/owner/manager tier),
  // regardless of the document's current status, as the audit-friendly
  // record of who reviewed it and what they decided (see app/api/documents/
  // [id]/review/route.ts's roundNumber comment for what a "round" means).
  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId: document.id },
    include: { reviewer: { select: { name: true } }, requestedBy: { select: { name: true } } },
    orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }],
  });
  const canSeeReviewTrail =
    reviewRequests.length > 0 &&
    (document.uploadedById === user.id ||
      document.ownerId === user.id ||
      user.role === "manager" ||
      user.role === "superadmin");

  // Every round's inline (highlight-and-comment) feedback, for anyone who
  // can see the trail at all (same audience as reviewRequests.comments
  // above) — previously only sent in the batched decision email/GChat
  // notice, never actually shown in-app to the uploader/owner. ReviewTrail
  // only surfaces a round's rows once that round is resolved, so a
  // still-pending round's comments — visible to the reviewer themselves via
  // InlineCommentReview below — stay out of this list until then, matching
  // how r.comments (the decision box) already only appears post-decision.
  const inlineComments = canSeeReviewTrail
    ? await prisma.inlineComment.findMany({
        where: { documentId: document.id },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Acting on a review (approve/reject/reassign/add-reviewers) requires
  // actually holding an active assignment for it — see the review route's
  // own enforcement of the same rule. Any manager being able to act on any
  // pending doc regardless of assignment would make "assign to a specific
  // reviewer" meaningless.
  const myPendingReview = reviewRequests.find((r) => r.reviewerId === user.id && r.status === "pending");
  // Approving only actually publishes once every other pending reviewer
  // (added via add-reviewers, a second/third opinion) has also approved —
  // see the "stillPending" check in app/api/documents/[id]/review/route.ts.
  // While others are still outstanding, approving here can't be the thing
  // that publishes, so the UI shouldn't call it "Approve & Publish" or ask
  // this reviewer to decide the announce-to-all question (only whichever
  // approval turns out to be the last one actually matters for that).
  const otherPendingReviewers = reviewRequests.filter(
    (r) => r.status === "pending" && r.reviewerId !== user.id
  ).length;

  // This reviewer's own highlight-and-comment feedback for their current
  // round (components/InlineCommentReview.tsx) — additive to the review
  // flow above, not part of it; empty when there's no active pending round
  // for this user.
  const myInlineComments = myPendingReview
    ? await prisma.inlineComment.findMany({
        where: { reviewRequestId: myPendingReview.id },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Open feedback from any user (components/DocumentFeedback.tsx) — only
  // fetched/shown once the publishing manager actually opted this document
  // into it (Document.feedbackEnabled, decided at publish time) and it's
  // still live; a revoked/archived copy stops showing this even if it was
  // enabled while published.
  const feedbackOpen = !isDeleted && document.status === "published" && document.feedbackEnabled;
  const feedback = feedbackOpen
    ? await prisma.documentFeedback.findMany({
        where: { documentId: document.id },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const canReview =
    !isDeleted &&
    can(user.role, "approveReview") &&
    (document.status === "pending_review" || document.status === "revoked") &&
    Boolean(myPendingReview);

  // Lets a reviewer undo their own already-recorded approval while the
  // document is still sitting in pending_review — i.e. before it actually
  // published, which only happens once every reviewer in the round has
  // approved (see otherPendingReviewers above / the "stillPending" check in
  // app/api/documents/[id]/review/route.ts). Once published there's nothing
  // left to undo, so this only ever applies pre-publish. Excludes anyone
  // with a fresh myPendingReview — a reviewer can end up with a stale
  // "approved" row from an earlier round (e.g. approved round 1, then a new
  // version reopened the document into round 2 with them as reviewer again)
  // and that old approval isn't what canReview's panel below is about, so
  // the two states must stay mutually exclusive rather than both showing.
  const myApprovedReview = reviewRequests.find((r) => r.reviewerId === user.id && r.status === "approved");
  const canUndoApproval =
    !isDeleted &&
    can(user.role, "approveReview") &&
    document.status === "pending_review" &&
    Boolean(myApprovedReview) &&
    !myPendingReview;

  // The base view-only "user" role only ever downloads the current
  // version (app/api/documents/[id]/download/route.ts enforces the same
  // restriction server-side) — everyone else can pick from any version.
  const canDownloadOldVersions = user.role !== "user";

  const canEdit =
    !isDeleted &&
    can(user.role, "editOwnUpload") &&
    (document.uploadedById === user.id ||
      document.ownerId === user.id ||
      user.role === "manager" ||
      user.role === "superadmin");

  // Replacing the file (UploadVersionForm) is narrower than editing the
  // rest of the document (canEdit above) once a document's been rejected —
  // only whoever uploaded the specific version that got rejected can
  // replace it and resubmit, not just any manager/superadmin or the
  // document's original uploader/owner. Outside of a rejection, the
  // broader canEdit-style rule still applies (any manager/superadmin can
  // push a new version of an already-published document). A document
  // that's currently mid-review (pending_review) is locked entirely — no
  // one can upload another version on top of the one already awaiting a
  // decision (see the same check in app/api/documents/[id]/versions/route.ts).
  const latestVersion = document.versions[0];
  const canUploadVersion =
    !isDeleted &&
    document.status !== "pending_review" &&
    can(user.role, "editOwnUpload") &&
    (document.status === "rejected"
      ? latestVersion?.uploadedById === user.id
      : document.uploadedById === user.id ||
        document.ownerId === user.id ||
        user.role === "manager" ||
        user.role === "superadmin");

  const canRevoke = !isDeleted && can(user.role, "revokeDocument") && document.status === "published";

  const canDelete =
    !isDeleted &&
    (can(user.role, "deleteDocument") ||
      (document.status === "pending_review" && document.uploadedById === user.id));

  const canArchive =
    !isDeleted &&
    can(user.role, "archiveDocument") &&
    (document.status === "published" || document.status === "rejected" || document.status === "revoked");
  const canUnarchive = !isDeleted && can(user.role, "archiveDocument") && document.status === "archived";
  const canRestore = isDeleted && can(user.role, "restoreDocument");
  const canManageLifecycle = !isDeleted && can(user.role, "manageDocumentLifecycle");

  const reviewDueAt = computeReviewDueDate(document, document.category.reviewCycleDays);
  const reviewDueInDays = document.neverExpires
    ? null
    : Math.ceil((reviewDueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isReviewDueSoon = reviewDueInDays !== null && reviewDueInDays <= 14;

  // Purge countdown — only meaningful (and only shown) once the document is
  // within 20 days of being permanently removed, so a fresh delete doesn't
  // immediately show a "29 days left" label nobody needs yet.
  const settings = isDeleted ? await getAppSettings() : null;
  const daysUntilPurge = isDeleted && document.deletedAt
    ? Math.ceil(
        settings!.deletedDocRetentionDays - (Date.now() - document.deletedAt.getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;
  const showPurgeCountdown = daysUntilPurge !== null && daysUntilPurge <= 20;

  const fields = (document.category.formSchema as unknown as CategoryFormField[]) ?? [];
  const metadata = (document.metadata as Record<string, unknown>) ?? {};

  // Same visibility conditions the old flat layout used for each section —
  // just extracted so a tab can decide whether it has anything to show
  // before rendering its button at all (see DocumentDetailTabs.tsx).
  const forReferenceVisible =
    !isDeleted &&
    !document.externalUrl &&
    (document.status === "pending_review" || document.status === "revoked") &&
    document.versions.length > 0 &&
    (canSeeReviewTrail || Boolean(myPendingReview));
  const reviewActionsVisible = canReview && Boolean(myPendingReview);
  const rejectedExplanationVisible =
    !isDeleted &&
    !document.externalUrl &&
    document.status === "rejected" &&
    !canUploadVersion &&
    Boolean(latestVersion) &&
    (canEdit || document.uploadedById === user.id || document.ownerId === user.id);

  const hasOverviewTab = fields.length > 0 || Boolean(document.externalUrl);
  // Deliberately excludes feedbackOpen — Feedback is open to every
  // authenticated user by design (components/DocumentFeedback.tsx), unlike
  // everything else grouped under "Review" (trail, actions, inline
  // comments), which stays uploader/owner/manager/reviewer-only. Keeping
  // them as separate tabs means a base "user" role never sees anything
  // labeled "Review" — only "Feedback", which is actually meant for them.
  const hasReviewTab = canSeeReviewTrail || forReferenceVisible || reviewActionsVisible || canUndoApproval;
  const hasFeedbackTab = feedbackOpen;
  const hasVersionsTab = !document.externalUrl;
  const hasManageTab = canManageLifecycle || canEdit || rejectedExplanationVisible;

  const reviewBadge = reviewActionsVisible
    ? { count: Math.max(inlineComments.length, 1), attention: true }
    : inlineComments.length > 0
    ? { count: inlineComments.length, attention: false }
    : null;
  const feedbackBadge = feedback.length > 0 ? { count: feedback.length, attention: false } : null;

  const tabs: DetailTab[] = [];

  if (hasOverviewTab) {
    tabs.push({
      key: "overview",
      label: "Overview",
      icon: <Info className="h-4 w-4" aria-hidden />,
      content: (
        <>
          <DocumentDetailsSection fields={fields} metadata={metadata} />
          {document.externalUrl && (
            <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
              <h2 className="mb-2 text-base font-bold text-ff-text">External Link</h2>
              <a
                href={document.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-ff-accent hover:underline"
              >
                {document.externalUrl}
              </a>
              <p className="mt-2 text-xs text-ff-textMuted">
                An externally-hosted file. No version history or download here.
              </p>
            </div>
          )}
        </>
      ),
    });
  }

  if (hasReviewTab) {
    tabs.push({
      key: "review",
      label: "Review",
      icon: <MessagesSquare className="h-4 w-4" aria-hidden />,
      badge: reviewBadge,
      content: (
        <div className="space-y-6">
          {canSeeReviewTrail && (
            <ReviewTrailWithHighlights
              documentStatus={document.status}
              uploadedByName={document.uploadedBy.name}
              uploadedAt={document.createdAt}
              reviewRequests={reviewRequests}
              inlineComments={inlineComments.map((c) => ({ ...c, editedAt: c.editedAt?.toISOString() ?? null }))}
              revoked={
                document.status === "revoked" && document.revokedAt
                  ? { byName: document.revokedBy?.name ?? "a manager", at: document.revokedAt, reason: document.revokeReason }
                  : null
              }
              documentId={document.id}
              version={(document.currentVersion ?? document.versions[0])?.versionNumber}
              hasPdf={
                document.docType === "pdf" || Boolean((document.currentVersion ?? document.versions[0])?.previewPdfPath)
              }
              extractedText={(document.currentVersion ?? document.versions[0])?.extractedText ?? ""}
              reviewerNameByRequestId={Object.fromEntries(reviewRequests.map((r) => [r.id, r.reviewer.name]))}
            />
          )}

          {forReferenceVisible && (
            <div className="flex flex-wrap items-center gap-4 rounded-ff border border-ff-border bg-white p-3 text-sm">
              <span className="font-medium text-ff-text">For reference:</span>
              {document.currentVersion && document.currentVersion.id !== document.versions[0].id && (
                <span className="flex items-center gap-1.5 text-ff-textMuted">
                  Current (v{document.currentVersion.versionNumber}):
                  <DownloadMenu
                    documentId={document.id}
                    version={document.currentVersion.versionNumber}
                    hasPreviewPdf={Boolean(document.currentVersion.previewPdfPath)}
                    docType={document.docType}
                    variant="link"
                  />
                </span>
              )}
              <span className="flex items-center gap-1.5 text-ff-textMuted">
                {document.currentVersion ? "New" : "Uploaded"} (v{document.versions[0].versionNumber}):
                {canDownloadOldVersions || document.versions[0].id === document.currentVersionId ? (
                  <DownloadMenu
                    documentId={document.id}
                    version={document.versions[0].versionNumber}
                    hasPreviewPdf={Boolean(document.versions[0].previewPdfPath)}
                    docType={document.docType}
                    variant="link"
                  />
                ) : (
                  <span className="text-xs">not yet available to download</span>
                )}
              </span>
            </div>
          )}

          {reviewActionsVisible && (
            <ReviewActions
              documentId={document.id}
              versions={document.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber }))}
              isOwnDocument={document.uploadedById === user.id}
              myReportsToId={user.reportsToId}
              otherPendingReviewers={otherPendingReviewers}
            />
          )}

          {reviewActionsVisible && (
            <InlineCommentReview
              documentId={document.id}
              // The version actually under review is the latest upload
              // (document.versions[0]), NOT document.currentVersion — while
              // pending_review, currentVersion is still the previously-
              // published copy (or nonexistent, on a document's first-ever
              // review), not what this reviewer is looking at. Both are
              // undefined for a docType "link" document (no versions at
              // all) — InlineCommentReview falls back to a plain comment
              // box in that case.
              version={document.versions[0]?.versionNumber}
              hasPdf={document.docType === "pdf" || Boolean(document.versions[0]?.previewPdfPath)}
              extractedText={document.versions[0]?.extractedText ?? ""}
              myUserId={user.id}
              initialComments={myInlineComments.map((c) => ({ ...c, editedAt: c.editedAt?.toISOString() ?? null }))}
            />
          )}

          {canUndoApproval && (
            <UndoApprovalButton documentId={document.id} otherPendingReviewers={otherPendingReviewers} />
          )}
        </div>
      ),
    });
  }

  if (hasVersionsTab) {
    tabs.push({
      key: "versions",
      label: "Versions",
      icon: <History className="h-4 w-4" aria-hidden />,
      badge: document.versions.length > 1 ? { count: document.versions.length, attention: false } : null,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-base font-bold text-ff-text">Version History</h2>
            <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
              <table className="w-full text-left text-sm">
                <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Version</th>
                    <th className="px-4 py-2 font-medium">Uploaded By</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Changelog</th>
                    <th className="px-4 py-2 font-medium">Preview</th>
                    <th className="px-4 py-2 font-medium">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {document.versions.map((v) => (
                    <tr key={v.id} className="border-t border-ff-border">
                      <td className="px-4 py-2">
                        v{v.versionNumber}
                        {v.id === document.currentVersionId ? (
                          <span className="ml-2 rounded-full bg-ff-success/15 px-2 py-0.5 text-xs text-ff-success">
                            current
                          </span>
                        ) : (
                          canManageLifecycle &&
                          document.status === "published" && (
                            <SetCurrentVersionButton
                              documentId={document.id}
                              versionId={v.id}
                              versionNumber={v.versionNumber}
                            />
                          )
                        )}
                      </td>
                      <td className="px-4 py-2 text-ff-textMuted">{v.uploadedBy.name}</td>
                      <td className="px-4 py-2 text-ff-textMuted">
                        <LocalDateTime value={v.uploadedAt} />
                      </td>
                      <td className="px-4 py-2 text-ff-textMuted">{v.changelog || "—"}</td>
                      <td className="px-4 py-2">
                        {!isDeleted && (
                          <DocumentPreview
                            documentId={document.id}
                            docType={document.docType}
                            version={v.versionNumber}
                            extractedText={v.extractedText}
                            hasPreviewPdf={Boolean(v.previewPdfPath)}
                            variant="link"
                            restrictToolbar={!canDownloadOldVersions && v.id !== document.currentVersionId}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {!isDeleted && (canDownloadOldVersions || v.id === document.currentVersionId) ? (
                          <DownloadMenu
                            documentId={document.id}
                            version={v.versionNumber}
                            hasPreviewPdf={Boolean(v.previewPdfPath)}
                            docType={document.docType}
                            variant="link"
                          />
                        ) : !isDeleted ? (
                          <span className="text-xs text-ff-textMuted">Current version only</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {document.versions.length > 1 &&
            (document.docType === "video" || document.docType === "link" || document.docType === "other" ? (
              <VersionDiff
                documentId={document.id}
                versions={document.versions.map((v) => ({
                  versionNumber: v.versionNumber,
                  extractedText: v.extractedText ?? "",
                }))}
              />
            ) : (
              // pdf/ppt/excel/doc — real side-by-side "as uploaded" preview
              // (app/api/documents/[id]/preview, the same accurate
              // LibreOffice-converted PDF the single-document view uses)
              // instead of an approximate re-parse of the file's own content.
              <VersionCompareFrame
                documentId={document.id}
                docType={document.docType}
                versions={document.versions.map((v) => ({ versionNumber: v.versionNumber, hasPreviewPdf: Boolean(v.previewPdfPath) }))}
              />
            ))}
        </div>
      ),
    });
  }

  if (hasManageTab) {
    tabs.push({
      key: "manage",
      label: "Manage",
      icon: <Settings className="h-4 w-4" aria-hidden />,
      content: (
        <div className="space-y-6">
          {canManageLifecycle && (
            <LifecycleActions
              documentId={document.id}
              isPermanent={document.neverExpires}
              showExtend={document.status === "published" && (isReviewDueSoon || (reviewDueInDays !== null && reviewDueInDays <= 0))}
              showDismissDuplicate={Boolean(document.duplicateOf)}
            />
          )}

          {canEdit && (
            <EditDocumentForm
              documentId={document.id}
              initialTitle={document.title}
              initialDocType={document.docType}
              initialTags={document.tags}
              fields={fields}
              initialMetadata={metadata}
            />
          )}

          {/* Explains why the replace icon isn't showing up top for a
              rejected document — otherwise the restriction (only the
              rejected version's own uploader can replace it) is invisible
              and just looks like the feature disappeared. */}
          {rejectedExplanationVisible && latestVersion && (
            <p className="text-xs text-ff-textMuted">
              This document was rejected. Only <strong>{latestVersion.uploadedBy.name}</strong>, who uploaded the
              rejected version, can replace it and resubmit for review.
            </p>
          )}
        </div>
      ),
    });
  }

  // Last on purpose — open feedback (anyone, not just uploader/reviewer/
  // manager) is the least "official" of these tabs, so it trails the
  // review/versions/manage tabs that carry the actual approval record
  // instead of leading them.
  if (hasFeedbackTab) {
    tabs.push({
      key: "feedback",
      label: "Feedback",
      icon: <MessageCircle className="h-4 w-4" aria-hidden />,
      badge: feedbackBadge,
      content: (
        <DocumentFeedback
          documentId={document.id}
          myUserId={user.id}
          canModerate={user.role === "manager" || user.role === "superadmin"}
          initialFeedback={feedback.map((f) => ({ ...f, editedAt: f.editedAt?.toISOString() ?? null }))}
        />
      ),
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <DocTypeIcon docType={document.docType} className="h-5 w-5 shrink-0 text-ff-textMuted" />
          <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight text-ff-text">{document.title}</h1>
          <span className="shrink-0 rounded-full bg-ff-lavender px-2 py-0.5 text-xs text-ff-text">
            {document.category.name}
          </span>
          {document.neverExpires ? (
            <span className="shrink-0 rounded-full bg-ff-success/15 px-2 py-0.5 text-xs text-ff-success">
              Permanent
            </span>
          ) : !isDeleted && document.status === "published" && reviewDueInDays !== null && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                reviewDueInDays <= 0
                  ? "bg-ff-danger/15 text-ff-danger"
                  : isReviewDueSoon
                  ? "bg-ff-warning/15 text-ff-warning"
                  : "bg-ff-lavender text-ff-textMuted"
              }`}
            >
              {reviewDueInDays <= 0 ? "Review overdue" : `Review due in ${reviewDueInDays} day${reviewDueInDays === 1 ? "" : "s"}`}
            </span>
          )}
          {showPurgeCountdown && (
            <span className="shrink-0 rounded-full bg-ff-danger/15 px-2 py-0.5 text-xs text-ff-danger">
              Available for {Math.max(0, daysUntilPurge!)} more day{daysUntilPurge === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-sm text-ff-textMuted">
            Owned by {document.owner.name} · Uploaded by {document.uploadedBy.name}
            {canManageLifecycle && !isDeleted && document.status === "published" && document.currentVersion && (
              <CurrentVersionControl
                documentId={document.id}
                currentVersionNumber={document.currentVersion.versionNumber}
                versions={document.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber }))}
              />
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Secondary/admin actions — visually de-emphasized and grouped
                ahead of the primary action, separated by a divider, so the
                one thing most people came here to do (preview/download)
                stays the visual focus instead of competing with manager-only
                controls that only sometimes apply. */}
            {(canRestore || canUploadVersion || canDelete || canArchive || canUnarchive || canRevoke) && (
              <div className="flex flex-wrap items-center gap-1.5 border-r border-ff-border pr-2">
                {canRestore && <RestoreButton documentId={document.id} />}
                {canUploadVersion && !document.externalUrl && (
                  <UploadVersionForm documentId={document.id} isRejected={document.status === "rejected"} />
                )}
                {canRevoke && <RevokeButton documentId={document.id} />}
                {(canArchive || canUnarchive) && (
                  <ArchiveButton documentId={document.id} archived={document.status === "archived"} />
                )}
                {canDelete && <DeleteButton documentId={document.id} title={document.title} />}
              </div>
            )}
            {!isDeleted && document.externalUrl && (
              <>
                <DocumentPreview documentId={document.id} docType={document.docType} externalUrl={document.externalUrl} />
                <ShareModal documentId={document.id} />
                <a
                  href={document.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
                >
                  Open Link
                </a>
              </>
            )}
            {!isDeleted && document.currentVersion && (
              <>
                <DocumentPreview
                  documentId={document.id}
                  docType={document.docType}
                  extractedText={document.currentVersion.extractedText}
                  hasPreviewPdf={Boolean(document.currentVersion.previewPdfPath)}
                />
                <ShareModal documentId={document.id} />
                <DownloadMenu
                  documentId={document.id}
                  hasPreviewPdf={Boolean(document.currentVersion.previewPdfPath)}
                  docType={document.docType}
                  variant="cta"
                  versions={
                    canDownloadOldVersions && document.versions.length > 1
                      ? document.versions.map((v) => ({ versionNumber: v.versionNumber, hasPreviewPdf: Boolean(v.previewPdfPath) }))
                      : undefined
                  }
                  currentVersionNumber={document.currentVersion.versionNumber}
                />
              </>
            )}
          </div>
        </div>

        {isDeleted && (
          <div className="mb-6 rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            This document was deleted by {document.deletedBy?.name ?? "a manager"} on{" "}
            {document.deletedAt && <LocalDateTime value={document.deletedAt} />}. It will be permanently removed after the
            configured retention window (see Settings) unless restored.
          </div>
        )}

        {!isDeleted && document.status === "revoked" && (
          <div className="mb-6 rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            Revoked{document.revokedBy && <> by {document.revokedBy.name}</>}
            {document.revokedAt && <> on <LocalDateTime value={document.revokedAt} /></>}. Hidden from the public
            dashboard until it&apos;s re-approved.
            {document.revokeReason && (
              <>
                {" "}
                <strong>Reason:</strong> {document.revokeReason}
              </>
            )}
          </div>
        )}

        {document.status === "archived" && (
          <div className="mb-6 rounded-ff border border-ff-border bg-ff-lavender/40 p-3 text-sm text-ff-text">
            This document has been archived and is hidden from the public dashboard.
          </div>
        )}

        {document.duplicateOf && (
          <div className="mb-6 rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3 text-sm text-ff-text">
            <strong>Possible duplicate:</strong> {document.duplicateReason}{" "}
            <Link href={`/dashboard/documents/${document.duplicateOf.id}`} className="text-ff-accent hover:underline">
              View &quot;{document.duplicateOf.title}&quot;
            </Link>
          </div>
        )}

        {document.stalenessFlags.length > 0 && (
          <div className="mb-6 rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3 text-sm text-ff-text">
            <strong>Flagged as potentially outdated:</strong>
            <ul className="ml-4 mt-1 list-disc">
              {document.stalenessFlags.map((f) => <li key={f.id}>{f.reason}</li>)}
            </ul>
          </div>
        )}

        <DocumentDetailTabs tabs={tabs} />
        </div>
      </main>
    </div>
  );
}

/**
 * Renders the category's custom-form answers with their real labels
 * (not raw field ids) — this is the whole point of the per-category form:
 * someone opening this doc months later gets the context inline instead
 * of having to track down the uploader.
 */
function DocumentDetailsSection({
  fields,
  metadata,
}: {
  fields: CategoryFormField[];
  metadata: Record<string, unknown>;
}) {
  if (fields.length === 0) return null;

  return (
    <section className="mb-8 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-3 text-base font-bold text-ff-text">Document Details</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const value = metadata[f.id];
          const display =
            f.type === "checkbox"
              ? value === true ? "Yes" : value === false ? "No" : "—"
              : (value as string) || "—";
          return (
            <div key={f.id}>
              <dt className="text-xs text-ff-textMuted">{f.label}</dt>
              <dd className="text-sm text-ff-text">{display}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
