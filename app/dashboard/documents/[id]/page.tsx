import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import DocTypeIcon from "@/components/DocTypeIcon";
import { prisma } from "@/lib/prisma";
import ReviewActions from "./ReviewActions";
import UndoApprovalButton from "./UndoApprovalButton";
import ReviewTrail from "./ReviewTrail";
import VersionDiff from "./VersionDiff";
import EditDocumentForm from "./EditDocumentForm";
import UploadVersionForm from "./UploadVersionForm";
import RevokeButton from "./RevokeButton";
import DeleteButton from "./DeleteButton";
import ArchiveButton from "./ArchiveButton";
import RestoreButton from "@/app/admin/deleted/RestoreButton";
import LifecycleActions from "./LifecycleActions";
import SetCurrentVersionButton from "./SetCurrentVersionButton";
import DocumentPreview from "@/components/DocumentPreview";
import DownloadMenu from "@/components/DownloadMenu";
import { formatDateTime } from "@/lib/formatDate";
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-4xl px-6 py-8 animate-fade-in">
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
          <p className="min-w-0 break-words text-sm text-ff-textMuted">
            Owned by {document.owner.name} · Uploaded by {document.uploadedBy.name}
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
                <DownloadMenu
                  documentId={document.id}
                  hasPreviewPdf={Boolean(document.currentVersion.previewPdfPath)}
                  docType={document.docType}
                  variant="cta"
                />
              </>
            )}
          </div>
        </div>

        {isDeleted && (
          <div className="mb-6 rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            This document was deleted by {document.deletedBy?.name ?? "a manager"} on{" "}
            {document.deletedAt && formatDateTime(document.deletedAt)}. It will be permanently removed after the
            configured retention window (see Settings) unless restored.
          </div>
        )}

        {canManageLifecycle && (
          <div className="mb-6">
            <LifecycleActions
              documentId={document.id}
              isPermanent={document.neverExpires}
              showExtend={document.status === "published" && (isReviewDueSoon || (reviewDueInDays !== null && reviewDueInDays <= 0))}
              showDismissDuplicate={Boolean(document.duplicateOf)}
            />
          </div>
        )}

        {!isDeleted && document.status === "revoked" && (
          <div className="mb-6 rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            Revoked{document.revokedBy && <> by {document.revokedBy.name}</>}
            {document.revokedAt && <> on {formatDateTime(document.revokedAt)}</>}. Hidden from the public
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

        {canSeeReviewTrail && (
          <ReviewTrail
            documentStatus={document.status}
            uploadedByName={document.uploadedBy.name}
            uploadedAt={document.createdAt}
            reviewRequests={reviewRequests}
            revoked={
              document.status === "revoked" && document.revokedAt
                ? { byName: document.revokedBy?.name ?? "a manager", at: document.revokedAt, reason: document.revokeReason }
                : null
            }
          />
        )}

        {canReview && myPendingReview && (
          <ReviewActions
            documentId={document.id}
            versions={document.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber }))}
            isOwnDocument={document.uploadedById === user.id}
            myReportsToId={user.reportsToId}
            otherPendingReviewers={otherPendingReviewers}
          />
        )}

        {canUndoApproval && (
          <UndoApprovalButton documentId={document.id} otherPendingReviewers={otherPendingReviewers} />
        )}

        {canEdit && (
          <div className="mb-6">
            <EditDocumentForm
              documentId={document.id}
              initialTitle={document.title}
              initialDocType={document.docType}
              initialTags={document.tags}
              fields={(document.category.formSchema as unknown as CategoryFormField[]) ?? []}
              initialMetadata={(document.metadata as Record<string, unknown>) ?? {}}
            />
          </div>
        )}

        {/* Explains why the replace icon isn't showing up top for a
            rejected document — otherwise the restriction (only the rejected
            version's own uploader can replace it) is invisible and just
            looks like the feature disappeared. */}
        {!isDeleted &&
          !document.externalUrl &&
          document.status === "rejected" &&
          !canUploadVersion &&
          latestVersion &&
          (canEdit || document.uploadedById === user.id || document.ownerId === user.id) && (
            <p className="mb-6 text-xs text-ff-textMuted">
              This document was rejected. Only <strong>{latestVersion.uploadedBy.name}</strong>, who uploaded the
              rejected version, can replace it and resubmit for review.
            </p>
          )}

        <DocumentDetailsSection
          fields={(document.category.formSchema as unknown as CategoryFormField[]) ?? []}
          metadata={(document.metadata as Record<string, unknown>) ?? {}}
        />

        {document.externalUrl && (
          <div className="mb-8 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
            <h2 className="mb-2 text-base font-bold text-ff-text">External Link</h2>
            <a href={document.externalUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-ff-accent hover:underline">
              {document.externalUrl}
            </a>
            <p className="mt-2 text-xs text-ff-textMuted">
              An externally-hosted file. No version history or download here.
            </p>
          </div>
        )}

        {!document.externalUrl && (
        <>
        <section className="mt-8">
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
                      {formatDateTime(v.uploadedAt)}
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
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {!isDeleted && (
                        <DownloadMenu
                          documentId={document.id}
                          version={v.versionNumber}
                          hasPreviewPdf={Boolean(v.previewPdfPath)}
                          docType={document.docType}
                          variant="link"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {document.versions.length > 1 && (
          <VersionDiff documentId={document.id} versions={document.versions.map((v) => ({
            versionNumber: v.versionNumber,
            extractedText: v.extractedText ?? "",
          }))} />
        )}
        </>
        )}
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
