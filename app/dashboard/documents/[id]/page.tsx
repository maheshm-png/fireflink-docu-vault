import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Info, MessagesSquare, MessageCircle, History, Settings, Clock, ChevronLeft, Ban, EyeOff } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can, type Role } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DocTypeIcon from "@/components/DocTypeIcon";
import Badge from "@/components/Badge";
import { prisma } from "@/lib/prisma";
import {
  canChangeAccess,
  canChangeDownloads,
  canRequestEveryone,
  canReviewDocument,
  documentRole,
  downloadsAllowed,
  involvedInReview,
  isSeesAllOutsider,
  canBypassReviewFor,
  canManageFolders,
  sharingAllowed,
  decidesEveryoneRequests,
  managesDocumentTeam,
  teamAllows,
  uploadableTeamIds,
} from "@/lib/access";
import EveryoneRequestPanel from "@/components/EveryoneRequestPanel";
import AccessBadges from "@/components/AccessBadges";
import DownloadSettings from "@/components/DownloadSettings";
import DocumentFolderSettings from "@/components/DocumentFolderSettings";
import ReviewActions from "./ReviewActions";
import UndoApprovalButton from "./UndoApprovalButton";
import ReviewTrailWithHighlights from "./ReviewTrailWithHighlights";
import VersionDiff from "./VersionDiff";
import VersionCompareFrame from "./VersionCompareFrame";
import EditDocumentForm from "./EditDocumentForm";
import UploadVersionForm from "./UploadVersionForm";
import DeleteButton from "./DeleteButton";
import ArchiveButton from "./ArchiveButton";
import RestoreButton from "@/app/admin/deleted/RestoreButton";
import LifecycleActions from "./LifecycleActions";
import FeedbackManagement from "./FeedbackManagement";
import ReviewVersionReference from "./ReviewVersionReference";
import SetCurrentVersionButton from "./SetCurrentVersionButton";
import CurrentVersionControl from "./CurrentVersionControl";
import DocumentDetailTabs, { type DetailTab } from "./DocumentDetailTabs";
import DocumentPreview from "@/components/DocumentPreview";
import DownloadMenu from "@/components/DownloadMenu";
import ShareModal from "@/components/ShareModal";
import ShareSettings from "@/components/ShareSettings";
import AccessSettings from "@/components/AccessSettings";
import ReviewHistoryModal from "@/components/ReviewHistoryModal";
import InfoTooltip from "@/components/InfoTooltip";
import InlineCommentReview from "@/components/InlineCommentReview";
import DocumentFeedback from "@/components/DocumentFeedback";
import { LocalDateTime } from "@/components/LocalDateTime";
import { computeReviewDueDate } from "@/lib/reviewDue";
import { getAppSettings } from "@/lib/settings";
import { everApprovedVersionIds, computeRoundAttempts } from "@/lib/versionRounds";
import type { CategoryFormField } from "@/lib/formSchema";

export default async function DocumentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // These three don't depend on each other's results (the notification
  // read-update and the review-trail fetch both only need params.id, which
  // is already known) — running them together instead of one after another
  // turns 3 round-trips into 1 on the single most-visited page in the app.
  const [document, , reviewRequests] = await Promise.all([
    prisma.document.findUnique({
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
        teamAccess: { select: { teamId: true, folderId: true, grantedById: true, team: { select: { name: true } } } },
        extraCategories: { select: { categoryId: true, category: { select: { name: true } } } },
        // The latest "Request for Everyone" (pending, or the last decision).
        globalRequests: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
        },
      },
    }),
    // Opening a document this user was notified about (the bell, and the
    // dashboard ticker's "New: ..." entries — see app/dashboard/page.tsx)
    // counts as having seen it, so it stops showing as unread/new anywhere
    // once they've actually looked at it, not just when they click through
    // the bell specifically.
    prisma.notification.updateMany({
      where: { userId: user.id, documentId: params.id, type: "published", read: false },
      data: { read: true },
    }),
    // The full review trail (every round, every reviewer, resolved or
    // not) — shown to anyone with a real stake in it (uploader/owner/
    // manager tier), regardless of the document's current status, as the
    // audit-friendly record of who reviewed it and what they decided (see
    // app/api/documents/[id]/review/route.ts's roundNumber comment for
    // what a "round" means).
    prisma.reviewRequest.findMany({
      where: { documentId: params.id },
      include: { reviewer: { select: { name: true, role: true } }, requestedBy: { select: { name: true } } },
      orderBy: [{ roundNumber: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  // Purged outright when its uploader withdrew it before review (see
  // DELETE /api/documents/:id), so an old link or open tab lands here.
  if (!document) notFound();

  // Team access control (lib/access.ts): a restricted document outside this
  // user's teams is a plain 404, as if it didn't exist, unless they're one
  // of its stakeholders (uploader, owner, a reviewer on any round).
  // The Global approver also gets in while a "Request for Everyone" waits
  // on a decision (lib/access.ts documentAccessWhere).
  const latestEveryoneRequest = document.globalRequests[0] ?? null;
  const pendingEveryoneRequest = latestEveryoneRequest?.status === "pending" ? latestEveryoneRequest : null;
  if (
    !teamAllows(user, document) &&
    document.uploadedById !== user.id &&
    document.ownerId !== user.id &&
    !reviewRequests.some((r) => r.reviewerId === user.id) &&
    !(decidesEveryoneRequests(user) && pendingEveryoneRequest)
  ) {
    notFound();
  }

  // Deleted documents are only reachable by manager/superadmin (to decide
  // whether to restore them) — everyone else, including a direct link,
  // bounces to the dashboard as if the document doesn't exist.
  if (document.deletedAt && !can(user.role, "viewDeleted")) {
    redirect("/dashboard");
  }
  const isDeleted = Boolean(document.deletedAt);
  // What this user may do to THIS document: their org role for an Everyone
  // document, their team role for a team document (lib/access.ts).
  // documentRole's manager rule needs who reviewed it (lib/access.ts).
  const stakeDoc = { ...document, reviewRequests };
  const docRole = documentRole(user, stakeDoc);
  // "Do they have a real stake in this document at all" — the page-ACCESS
  // gate below reuses this raw check directly, and every other
  // stakeholder-gated boolean on this page is built from it too. One
  // document view for everyone: what you see here reflects what you can
  // actually do, not which link you happened to click.
  const isStakeholder =
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    docRole === "manager" ||
    docRole === "superadmin";
  // Whether this specific person has ever actually been assigned to review
  // this document (any round, any status) — narrower than isStakeholder's
  // blanket "any manager," and shared by both the visibility gate and the
  // delete restriction further down.
  const wasEverReviewer = reviewRequests.some((r) => r.reviewerId === user.id);
  const canSeeReviewTrail = reviewRequests.length > 0 && isStakeholder;

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

  // Neither of these depends on the other, so they run together — same
  // "don't serialize independent round-trips" reasoning as the Promise.all
  // above.
  const [inlineComments, myInlineComments] = await Promise.all([
    // Every round's inline (highlight-and-comment) feedback, for anyone who
    // can see the trail at all (same audience as reviewRequests.comments
    // above) — previously only sent in the batched decision email/GChat
    // notice, never actually shown in-app to the uploader/owner. ReviewTrail
    // only surfaces a round's rows once that round is resolved, so a
    // still-pending round's comments — visible to the reviewer themselves
    // via InlineCommentReview below — stay out of this list until then,
    // matching how r.comments (the decision box) already only appears
    // post-decision.
    canSeeReviewTrail
      ? prisma.inlineComment.findMany({
          where: { documentId: document.id },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    // This reviewer's own highlight-and-comment feedback for their current
    // round (components/InlineCommentReview.tsx) — additive to the review
    // flow above, not part of it; empty when there's no active pending
    // round for this user.
    myPendingReview
      ? prisma.inlineComment.findMany({
          where: { reviewRequestId: myPendingReview.id },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // feedbackOpen/feedback are computed further down, right after
  // hasEverPublished — feedback should stay available while a document that
  // WAS published sits mid-re-review (old version still live), not just
  // while its raw status is literally "published" this instant, so it
  // needs that computed answer rather than the raw status field.

  // Holding the assignment is enough to see the panel; deciding also needs
  // canReviewDocument (lib/access.ts). Someone assigned before team roles
  // who no longer qualifies can still reassign it (decideBlockedReason).
  const canReview =
    !isDeleted &&
    (document.status === "pending_review" || document.status === "revoked") &&
    Boolean(myPendingReview);
  const decideBlockedReason = canReviewDocument(user, document)
    ? null
    : document.visibility === "restricted"
      ? "Only a manager of this document's team can approve or reject it. Reassign it to one of them."
      : "Only a manager can approve or reject this document. Reassign it to one.";

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
    canReviewDocument(user, document) &&
    document.status === "pending_review" &&
    Boolean(myApprovedReview) &&
    !myPendingReview;

  const canEdit =
    !isDeleted &&
    can(docRole, "editOwnUpload") &&
    (document.uploadedById === user.id ||
      document.ownerId === user.id ||
      docRole === "manager" ||
      docRole === "superadmin");

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
    can(docRole, "editOwnUpload") &&
    (document.status === "rejected"
      ? latestVersion?.uploadedById === user.id
      : document.uploadedById === user.id ||
        document.ownerId === user.id ||
        docRole === "manager" ||
        docRole === "superadmin");

  // Once a document has been approved by SOME manager, a manager who was
  // never actually part of that decision (never assigned as a reviewer on
  // any round, and isn't the uploader/owner) can no longer delete it —
  // deliberately narrower than isStakeholder above, which counts any
  // manager. A document that's never been approved (still pending_review,
  // or rejected every time) isn't protected by this yet, since no
  // manager's decision is being second-guessed by deleting it.
  const everApproved = reviewRequests.some((r) => r.status === "approved");
  const inReviewCycle = document.uploadedById === user.id || document.ownerId === user.id || wasEverReviewer;

  const canDelete =
    !isDeleted &&
    ((can(docRole, "deleteDocument") && (!everApproved || inReviewCycle)) ||
      (document.status === "pending_review" && document.uploadedById === user.id));
  // Same rule as isWithdrawalBeforeReview (lib/purgeDocument.ts), which the
  // DELETE route uses to purge instead of soft-delete: tells the button to
  // warn that this can't be undone.
  const deletePurges =
    document.status === "pending_review" &&
    document.uploadedById === user.id &&
    !document.revokedAt &&
    reviewRequests.every((r) => r.status === "pending");

  const canArchive =
    !isDeleted &&
    can(docRole, "archiveDocument") &&
    (document.status === "published" || document.status === "rejected" || document.status === "revoked");
  const canUnarchive = !isDeleted && can(docRole, "archiveDocument") && document.status === "archived";
  const canRestore = isDeleted && can(docRole, "restoreDocument");
  const canManageLifecycle = !isDeleted && can(docRole, "manageDocumentLifecycle");

  // A rejected (or still mid-review) version was never actually published —
  // "Set as current" can only ever roll back/forward to a version that
  // really was approved at some point, not resurrect one nobody signed off
  // on. Its own history/comments stay visible in the Review tab regardless.
  const approvedVersionIds = everApprovedVersionIds(
    document.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt })),
    reviewRequests.map((r) => ({ roundNumber: r.roundNumber, status: r.status, comments: r.comments, createdAt: r.createdAt })),
    document.revokedAt
  );
  // The same underlying computation as approvedVersionIds above, but its
  // full shape (byVersionId/byRoundNumber/groups) — everything below that
  // shows a version or round as text reads its label from here instead of
  // the raw versionNumber/roundNumber, and the Version History table's
  // merged Round column and the Review Status stepper's round groups come
  // straight from `roundAttempts.groups`. See lib/versionRounds.ts's own
  // header comment for what a "Round.Attempt" label means and why.
  const roundAttempts = computeRoundAttempts(
    document.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt })),
    reviewRequests.map((r) => ({ roundNumber: r.roundNumber, status: r.status, comments: r.comments, createdAt: r.createdAt })),
    document.revokedAt
  );
  const versionLabel = (versionId: string, fallbackVersionNumber: number) =>
    roundAttempts.byVersionId.get(versionId)?.label ?? `v${fallbackVersionNumber}`;

  // What the Versions tab (and its Download/Compare controls) actually
  // shows: a stakeholder (uploader/owner/manager/superadmin) sees the whole
  // real history, rejected and still-pending attempts included, since they
  // have a real reason to audit those. Everyone else only ever sees versions
  // that genuinely passed review at some point — old published versions,
  // plus whatever's current — never a rejected or not-yet-decided one.
  // Every version in this filtered list is safe to fully preview/download,
  // so nothing downstream needs its own extra "is this one okay" check.
  const versionsVisibleToViewer = canSeeReviewTrail
    ? document.versions
    : document.versions.filter((v) => approvedVersionIds.has(v.id));

  // A high-level, public-safe cut of the same history — every viewer, not
  // just a stakeholder, gets to see "who approved which version," so the
  // full review cycle isn't a total black box even for a plain view-only
  // "user" (or a contributor just passing by someone else's document).
  // Deliberately narrow: only versions that actually got approved (never a
  // rejected attempt), only the reviewer(s) whose decision was "approved"
  // (never a rejecter, and never a still-pending assignment), and no
  // comments at all — that detail stays behind the full Review tab, which
  // only a real stakeholder can reach.
  const approvalHistory = [...document.versions]
    .sort((a, b) => a.versionNumber - b.versionNumber)
    .filter((v) => approvedVersionIds.has(v.id))
    .map((v) => {
      const approvals = reviewRequests.filter(
        (r) => r.status === "approved" && roundAttempts.byRoundNumber.get(r.roundNumber)?.versionId === v.id
      );
      const reviewerNames = [...new Set(approvals.map((r) => r.reviewer.name))];
      const approvedAt = approvals.reduce<Date | null>((latest, r) => {
        if (!r.resolvedAt) return latest;
        return !latest || r.resolvedAt > latest ? r.resolvedAt : latest;
      }, null);
      // Published with "No review needed": not an approval by anyone else.
      const bypassed = approvals.length > 0 && approvals.every((r) => r.comments?.startsWith("Review bypassed:"));
      return { versionId: v.id, label: versionLabel(v.id, v.versionNumber), reviewerNames, approvedAt, bypassed };
    });

  // document.currentVersionId can be stale on a document created before
  // this check existed: it used to get set to v1 the moment a document was
  // first uploaded, before any review at all (fixed in app/api/documents/
  // route.ts), so a document whose only round was REJECTED can still have
  // currentVersionId pointing at that same never-approved version. Treating
  // document.currentVersion as gospel everywhere below would keep showing
  // Share/Download/"Current" for a document that's never actually been
  // published — this is the single place that gets corrected, so every
  // read of "is there a real current version" below goes through it
  // instead of the raw (possibly stale) field.
  const hasEverPublished = document.currentVersionId !== null && approvedVersionIds.has(document.currentVersionId);
  const effectiveCurrentVersion = hasEverPublished ? document.currentVersion : null;

  // "Publicly visible" = there's a real approved version AND a manager
  // hasn't explicitly pulled it back out of circulation (revoke/archive both
  // do that on purpose — see their own routes). A document simply back in
  // re-review after already being published once (status pending_review or
  // rejected, but hasEverPublished still true) still counts: its old
  // version stays live/searchable throughout, same as everywhere else this
  // session's work treats that state.
  const isPubliclyVisible = hasEverPublished && document.status !== "revoked" && document.status !== "archived";

  // While a document isn't publicly visible yet (still pending_review, or
  // rejected/revoked with nothing ever approved), only people with an
  // actual stake in THIS specific document's review can open it: the
  // uploader, the owner, whoever's actually assigned as a reviewer on any
  // round, or superadmin (org-wide oversight, same as viewDeleted/the audit
  // log). Deliberately narrower than isStakeholder above (which counts any
  // manager by role alone) — a manager with no assignment on this document
  // has no more business opening its still-pending content early than any
  // other uninvolved user does; "assign to a specific reviewer" otherwise
  // means little if every manager can already see it. Mirrors GET
  // /api/documents/[id]/route.ts's canSeeUnpublished and the download/
  // preview routes' own copies of this same check.
  const canSeeUnpublishedDoc =
    document.uploadedById === user.id ||
    document.ownerId === user.id ||
    wasEverReviewer ||
    user.role === "superadmin";
  if (!isPubliclyVisible && !canSeeUnpublishedDoc) {
    redirect("/dashboard");
  }

  // Feedback VISIBILITY tracks the same "is this actually visible" answer
  // as the page-access gate right above, not the raw status field — a
  // document mid-re-review still shows its old version's feedback (feedback
  // is only ever collected against the currently-live version's overall
  // record, not a specific one), but a revoked/archived copy stops showing
  // it even if it was enabled while published. Deliberately NOT also gated
  // on document.feedbackEnabled anymore: that flag only controls whether
  // NEW feedback can be POSTed (see the feedback route's PATCH handler and
  // FeedbackManagement.tsx's toggle) — turning it off to stop taking new
  // comments shouldn't also hide what's already been left.
  const feedbackVisible = !isDeleted && isPubliclyVisible;
  const feedback = feedbackVisible
    ? await prisma.documentFeedback.findMany({
        where: { documentId: document.id },
        include: {
          user: { select: { name: true } },
          statusChangedBy: { select: { name: true, role: true } },
          taggedUser: { select: { name: true, role: true } },
          replies: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Who a feedback author can tag (components/DocumentFeedback.tsx's compose
  // picker) — this document's contributor, plus every distinct reviewer
  // it's ever had, minus the viewer themselves (tagging yourself isn't
  // useful). Same set app/api/documents/[id]/feedback/route.ts's POST
  // validates a submitted tag against, so the two never drift apart.
  const taggableUsersById = new Map<string, { name: string; role: Role }>();
  if (feedbackVisible) {
    taggableUsersById.set(document.uploadedById, { name: document.uploadedBy.name, role: document.uploadedBy.role as Role });
    for (const r of reviewRequests) {
      taggableUsersById.set(r.reviewerId, { name: r.reviewer.name, role: r.reviewer.role as Role });
    }
    taggableUsersById.delete(user.id);
  }
  const taggableUsers = [...taggableUsersById.entries()].map(([id, v]) => ({ id, ...v }));

  // A manager, or this specific document's own uploader, can turn feedback
  // collection on/off and triage individual items even after publish — see
  // FeedbackManagement.tsx and the routes it calls.
  const canManageFeedback =
    document.uploadedById === user.id || docRole === "manager" || docRole === "superadmin";

  // Same permission as canManageFeedback above, kept as its own named flag
  // since it gates a different feature (components/ShareSettings.tsx) —
  // see Document.shareEnabled's own schema comment.
  const canManageSharing =
    document.uploadedById === user.id || docRole === "manager" || docRole === "superadmin";

  // Team access control (lib/access.ts). canChangeAccess mirrors PATCH
  // /api/documents/[id]/access exactly; teamOptions are the teams this
  // viewer may tick (theirs, or all for a superadmin) plus any
  // already on the document, shown locked when they aren't in it.
  const canEditAccess = !isDeleted && canChangeAccess(user, stakeDoc, "restricted");
  // Downloads turned off: preview only, for everyone.
  const previewOnly = !downloadsAllowed(document);
  const canEditDownloads = !isDeleted && canChangeDownloads(user, stakeDoc) && Boolean(document.currentVersionId);
  const canOpenToOrg = canChangeAccess(user, stakeDoc, "org");
  // Superadmins and the document's team managers (extending it to other
  // teams) may add any team; anyone else only teams they contribute to. A
  // team already on the document may only be removed by someone in it, or by
  // whoever added it (undoing a mistake).
  const extendsToAnyTeam = user.role === "superadmin" || managesDocumentTeam(user, document);
  const addableTeamIds = uploadableTeamIds(user);
  const currentAccessTeamIds = document.teamAccess.map((a) => a.teamId);
  const teamOptions = canEditAccess
    ? (
        await prisma.team.findMany({
          where: extendsToAnyTeam || !addableTeamIds ? {} : { id: { in: [...addableTeamIds, ...currentAccessTeamIds] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      ).map((t) => ({
        ...t,
        selectable: currentAccessTeamIds.includes(t.id)
          ? user.role === "superadmin" ||
            user.teamIds.includes(t.id) ||
            document.teamAccess.some((a) => a.teamId === t.id && a.grantedById === user.id)
          : extendsToAnyTeam || !addableTeamIds || addableTeamIds.includes(t.id),
      }))
    : [];
  // "Request for Everyone": team managers raise it from the Manage tab once
  // the document is published; the Global approver decides it above the tabs.
  const showEveryoneRequest = !isDeleted && document.status === "published" && canRequestEveryone(user, document);
  const showEveryoneDecision =
    !isDeleted && decidesEveryoneRequests(user) && Boolean(pendingEveryoneRequest) && pendingEveryoneRequest?.requestedById !== user.id;
  // Shown to the team manager before they send a Request for Everyone.
  const globalApproverName = showEveryoneRequest
    ? (await prisma.user.findFirst({ where: { isGlobalApprover: true, role: "manager", isActive: true }, select: { name: true } }))?.name ?? null
    : null;
  const everyonePending = pendingEveryoneRequest
    ? {
        requestedByName: pendingEveryoneRequest.requestedBy.name,
        reason: pendingEveryoneRequest.reason,
        createdAt: pendingEveryoneRequest.createdAt.toISOString(),
      }
    : null;
  // Someone who "Sees all teams" may comment on any team's document, even
  // with feedback off.
  const leadershipComment = isSeesAllOutsider(user, document);

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
  // For the edit form's category picker (main category + "Also show in").
  // Team documents have no category to change (lib/teamCategory.ts).
  const allCategories =
    canEdit && document.visibility !== "restricted"
      ? await prisma.category.findMany({ where: { isSystem: false }, orderBy: { name: "asc" }, select: { id: true, name: true, formSchema: true } })
      : [];
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
  // The approving manager may restrict the document to ANY team (the review
  // route's checkAccessChange asApprover), so every team is offered.
  const approvalTeamOptions = reviewActionsVisible
    ? (await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })).map((t) => ({
        ...t,
        selectable: true,
      }))
    : [];
  const rejectedExplanationVisible =
    !isDeleted &&
    !document.externalUrl &&
    document.status === "rejected" &&
    !canUploadVersion &&
    Boolean(latestVersion) &&
    (canEdit || document.uploadedById === user.id || document.ownerId === user.id);

  const hasOverviewTab = fields.length > 0 || Boolean(document.externalUrl);
  // Deliberately excludes feedbackVisible — Feedback is open to every
  // authenticated user by design (components/DocumentFeedback.tsx), unlike
  // everything else grouped under "Review" (trail, actions, inline
  // comments), which stays uploader/owner/manager/reviewer-only. Keeping
  // them as separate tabs means a base "user" role never sees anything
  // labeled "Review" — only "Feedback", which is actually meant for them.
  const hasReviewTab = canSeeReviewTrail || forReferenceVisible || reviewActionsVisible || canUndoApproval;
  // Shown when new feedback can still be posted, OR there's already some to
  // read — not just document.feedbackEnabled alone, since turning that off
  // (FeedbackManagement.tsx) only stops new submissions, it shouldn't hide
  // a tab that still has existing feedback worth reading.
  const hasFeedbackTab = feedbackVisible && (document.feedbackEnabled || leadershipComment || feedback.length > 0);
  // Always shown for any non-link document — its CONTENTS vary instead
  // (versionsVisibleToViewer below, keyed off canSeeReviewTrail): a
  // stakeholder sees the real full history, a base "user" (or a contributor
  // viewing someone else's document) sees only versions that actually
  // passed review, never a rejected or still-pending one.
  const hasVersionsTab = !document.externalUrl;
  // canManageFeedback is its own independent grant (the document's uploader
  // gets it even if their role has since been changed to one without
  // editOwnUpload/manageDocumentLifecycle) — without including it here too,
  // someone who can legitimately triage feedback could end up with no
  // Manage tab to reach FeedbackManagement from at all.
  // Folder per team (Home > My teams), for the teams whose folders this
  // viewer manages (lib/access.ts canManageFolders).
  const folderTeams =
    !isDeleted && document.visibility === "restricted"
      ? document.teamAccess.filter((a) => canManageFolders(user, a.teamId))
      : [];
  const folderOptions = folderTeams.length
    ? await prisma.teamFolder.findMany({
        where: { teamId: { in: folderTeams.map((a) => a.teamId) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, teamId: true },
      })
    : [];
  const folderControls = folderTeams.map((a) => ({
    teamId: a.teamId,
    teamName: a.team.name,
    folderId: a.folderId,
    folders: folderOptions.filter((f) => f.teamId === a.teamId).map(({ id, name }) => ({ id, name })),
  }));

  const hasManageTab =
    folderControls.length > 0 ||
    canManageLifecycle ||
    canEdit ||
    rejectedExplanationVisible ||
    (canManageFeedback && hasEverPublished) ||
    (canManageSharing && hasEverPublished) ||
    canEditAccess ||
    canEditDownloads ||
    showEveryoneRequest;

  const reviewBadge = reviewActionsVisible
    ? { count: Math.max(inlineComments.length, 1), attention: true }
    : inlineComments.length > 0
    ? { count: inlineComments.length, attention: false }
    : null;
  const feedbackBadge = feedback.length > 0 ? { count: feedback.length, attention: false } : null;

  // "What you can do here": one plain line so nobody has to guess what
  // their role allows on this document, and who to ask for the rest.
  const live = !isDeleted && isPubliclyVisible;
  const teamDoc = document.visibility === "restricted";
  const youCan: string[] = ["view it"];
  if (live && effectiveCurrentVersion && !previewOnly) youCan.push("download it");
  if (live && document.shareEnabled && sharingAllowed(document)) youCan.push("share it with customers");
  if (feedbackVisible && (document.feedbackEnabled || leadershipComment)) youCan.push("leave feedback");
  if (reviewActionsVisible) youCan.push("approve or reject it");
  if (canEdit) youCan.push("edit its details");
  if (canUploadVersion) youCan.push("upload a new version");
  if (folderControls.length > 0) youCan.push("move it between folders");
  if (canArchive) youCan.push("archive it");
  if (canUnarchive) youCan.push("restore it");
  if (canDelete) youCan.push("delete it");
  const youCannot: string[] = [];
  if (live && previewOnly) youCannot.push("download it (preview only)");
  if (live && teamDoc) youCannot.push("share it outside the company (team document)");
  else if (live && !document.shareEnabled) youCannot.push("share it (sharing is turned off)");
  if (!canEdit && !isDeleted && document.uploadedById !== user.id) {
    youCannot.push(`change it: only ${document.uploadedBy.name} and the managers who reviewed it can`);
  }

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
        // Standard meaningful order for a reviewer working through this
        // tab top to bottom: what am I reviewing (Reference) -> what's the
        // history so far (Review Status/Document Comments) -> my own
        // feedback on this version (Inline Comments) -> the decision
        // itself (Approve/Reject) -> the rare undo escape hatch, always
        // last since it's not part of the normal flow.
        <div className="space-y-6">
          {forReferenceVisible && (
            <ReviewVersionReference
              documentId={document.id}
              docType={document.docType}
              publishedVersion={
                effectiveCurrentVersion && effectiveCurrentVersion.id !== document.versions[0].id
                  ? {
                      versionNumber: effectiveCurrentVersion.versionNumber,
                      label: versionLabel(effectiveCurrentVersion.id, effectiveCurrentVersion.versionNumber),
                      previewPdfPath: effectiveCurrentVersion.previewPdfPath,
                      extractedText: effectiveCurrentVersion.extractedText,
                    }
                  : null
              }
              previewOnly={previewOnly}
              pendingVersion={{
                versionNumber: document.versions[0].versionNumber,
                label: versionLabel(document.versions[0].id, document.versions[0].versionNumber),
                previewPdfPath: document.versions[0].previewPdfPath,
                extractedText: document.versions[0].extractedText,
              }}
              // Same rule as app/api/documents/[id]/download/route.ts: the
              // live version follows the Preview only choice; a version still
              // under review is downloadable only by its uploader and reviewers.
              pendingDownloadable={
                document.versions[0].id === effectiveCurrentVersion?.id
                  ? !previewOnly
                  : involvedInReview(user, document, reviewRequests)
              }
              compareVersions={document.versions.map((v) => ({
                versionNumber: v.versionNumber,
                label: versionLabel(v.id, v.versionNumber),
                hasPreviewPdf: Boolean(v.previewPdfPath),
                extractedText: v.extractedText ?? "",
              }))}
            />
          )}

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
              versions={[...document.versions]
                .sort((a, b) => a.versionNumber - b.versionNumber)
                .map((v) => ({
                  id: v.id,
                  versionNumber: v.versionNumber,
                  extractedText: v.extractedText ?? "",
                  hasPdf: document.docType === "pdf" || Boolean(v.previewPdfPath),
                }))}
              roundGroups={roundAttempts.groups}
              reviewerNameByRequestId={Object.fromEntries(reviewRequests.map((r) => [r.id, r.reviewer.name]))}
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

          {reviewActionsVisible && (
            <ReviewActions
              documentId={document.id}
              // Only the version this round is actually deciding on (the
              // newest upload) plus anything genuinely approved before —
              // never a version rejected in an earlier round, which the
              // review route itself now also rejects if picked anyway (see
              // its own versionId check) — this just keeps it from ever
              // being offered as an option in the first place.
              versions={document.versions
                .filter((v) => v.id === document.versions[0].id || approvedVersionIds.has(v.id))
                .map((v) => ({ id: v.id, versionNumber: v.versionNumber, label: versionLabel(v.id, v.versionNumber) }))}
              // Uploaded the document, or the version being reviewed: either
              // way they can't approve it (same rule as the review route).
              isOwnDocument={document.uploadedById === user.id || document.versions[0]?.uploadedById === user.id}
              decideBlockedReason={decideBlockedReason}
              myReportsToId={user.reportsToId}
              otherPendingReviewers={otherPendingReviewers}
              restrictedToTeamIds={document.visibility === "restricted" ? currentAccessTeamIds : null}
              currentVisibility={document.visibility}
              currentDownloadable={document.downloadable}
              currentTeamIds={currentAccessTeamIds}
              currentTeamNames={document.teamAccess.map((a) => a.team.name).sort()}
              teamOptions={approvalTeamOptions}
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
      badge: versionsVisibleToViewer.length > 1 ? { count: versionsVisibleToViewer.length, attention: false } : null,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-base font-bold text-ff-text">Version History</h2>
            <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
              <table className="w-full text-left text-sm">
                <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Round</th>
                    <th className="px-4 py-2 font-medium">Version</th>
                    <th className="px-4 py-2 font-medium">Reviewer</th>
                    <th className="px-4 py-2 font-medium">Uploaded By</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Changelog</th>
                    <th className="px-4 py-2 font-medium">Preview</th>
                    <th className="px-4 py-2 font-medium">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Reviewer(s) whose ReviewRequest round maps (via
                    // roundAttempts) to a given version — a version can be
                    // reviewed by more than one round (a second opinion, or
                    // a later recheck reusing the same version), so this
                    // dedupes by name across all of them.
                    const reviewersByVersionId = new Map<string, string[]>();
                    for (const r of reviewRequests) {
                      const versionId = roundAttempts.byRoundNumber.get(r.roundNumber)?.versionId;
                      if (!versionId) continue;
                      const names = reviewersByVersionId.get(versionId) ?? [];
                      if (!names.includes(r.reviewer.name)) names.push(r.reviewer.name);
                      reviewersByVersionId.set(versionId, names);
                    }
                    const rows = versionsVisibleToViewer.map((v) => ({
                      version: v,
                      round: roundAttempts.byVersionId.get(v.id)?.round ?? v.versionNumber,
                    }));
                    // versionsVisibleToViewer is already newest-first (it's
                    // filtered from document.versions, which is) — a Round's
                    // attempts stay adjacent in that order (attempts within
                    // a round are always consecutive versionNumbers), so a
                    // run of matching `round` values is exactly the span to
                    // merge into one rowSpan'd cell.
                    const roundSpanCounts = new Map<number, number>();
                    for (const { round } of rows) roundSpanCounts.set(round, (roundSpanCounts.get(round) ?? 0) + 1);

                    return rows.map(({ version: v, round }, i) => {
                      const isNewRoundGroup = i === 0 || rows[i - 1].round !== round;
                      const reviewerNames = reviewersByVersionId.get(v.id) ?? [];
                      return (
                        <tr key={v.id} className="border-t border-ff-border">
                          {isNewRoundGroup && (
                            <td
                              rowSpan={roundSpanCounts.get(round)}
                              className="border-r border-ff-border px-4 py-2 align-top font-semibold text-ff-text"
                            >
                              Round {round}
                            </td>
                          )}
                          <td className="px-4 py-2">
                            {versionLabel(v.id, v.versionNumber)}
                            {v.id === effectiveCurrentVersion?.id ? (
                              <span className="ml-2 rounded-full bg-ff-success/15 px-2 py-0.5 text-xs text-ff-success">
                                current
                              </span>
                            ) : (
                              canManageLifecycle &&
                              document.status === "published" &&
                              approvedVersionIds.has(v.id) && (
                                <SetCurrentVersionButton
                                  documentId={document.id}
                                  versionId={v.id}
                                  versionLabel={versionLabel(v.id, v.versionNumber)}
                                />
                              )
                            )}
                          </td>
                          <td className="px-4 py-2 text-ff-textMuted">{reviewerNames.join(", ") || "N/A"}</td>
                          <td className="px-4 py-2 text-ff-textMuted">{v.uploadedBy.name}</td>
                          <td className="px-4 py-2 text-ff-textMuted">
                            <LocalDateTime value={v.uploadedAt} />
                          </td>
                          <td className="px-4 py-2 text-ff-textMuted">{v.changelog || "N/A"}</td>
                          <td className="px-4 py-2">
                            {/* Every row here already only ever comes from
                                versionsVisibleToViewer — a stakeholder sees
                                the real full history (rejected/pending
                                included, restrictToolbar off), everyone else
                                only ever sees versions that actually passed
                                review, so there's nothing left to restrict. */}
                            {!isDeleted && (
                              <DocumentPreview
                                documentId={document.id}
                                docType={document.docType}
                                version={v.versionNumber}
                                extractedText={v.extractedText}
                                hasPreviewPdf={Boolean(v.previewPdfPath)}
                                variant="link"
                                previewOnly={previewOnly}
                              />
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {/* Download, unlike Preview above, is
                                restricted to the current live version only
                                — everyone else (older approved versions,
                                the pending one, rejected attempts) is
                                view-only now, regardless of role. Matches
                                app/api/documents/[id]/download/route.ts's
                                own enforcement. */}
                            {!isDeleted && !previewOnly && v.id === effectiveCurrentVersion?.id ? (
                              <DownloadMenu
                                documentId={document.id}
                                version={v.versionNumber}
                                hasPreviewPdf={Boolean(v.previewPdfPath)}
                                docType={document.docType}
                                variant="link"
                              />
                            ) : (
                              !isDeleted && <span className="text-xs text-ff-textMuted">{previewOnly ? "Preview only" : "Not available"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </section>

          {/* Comparing versions side by side — everyone gets this now, not
              just a stakeholder, but always through versionsVisibleToViewer
              (already the approved-only cut for a non-stakeholder, same
              list the table above renders): a plain view-only "user" can
              compare an old approved version against the current one, never
              a rejected or still-pending attempt — that detail stays behind
              the full Review tab. */}
          {versionsVisibleToViewer.length > 1 &&
            (document.docType === "video" || document.docType === "link" || document.docType === "other" ? (
              <VersionDiff
                documentId={document.id}
                versions={versionsVisibleToViewer.map((v) => ({
                  versionNumber: v.versionNumber,
                  label: versionLabel(v.id, v.versionNumber),
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
                versions={versionsVisibleToViewer.map((v) => ({
                  versionNumber: v.versionNumber,
                  label: versionLabel(v.id, v.versionNumber),
                  hasPreviewPdf: Boolean(v.previewPdfPath),
                }))}
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
        <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
          <div className="border-b border-ff-border px-4 py-3">
            <h3 className="text-sm font-bold text-ff-text">Document Settings</h3>
            <p className="text-xs text-ff-textMuted">Retention, review schedule, and document details.</p>
          </div>
          <div className="divide-y divide-ff-border">
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
                initialMetadata={metadata}
                categories={allCategories.map((c) => ({ id: c.id, name: c.name, fields: (c.formSchema as unknown as CategoryFormField[]) ?? [] }))}
                initialCategoryId={document.categoryId}
                initialExtraCategoryIds={document.extraCategories.map((e) => e.categoryId)}
              />
            )}

            {/* Only meaningful once the document's actually been published
                at least once — feedback can never exist before that (see
                the feedback POST route's own status check). */}
            {canManageFeedback && hasEverPublished && (
              <FeedbackManagement documentId={document.id} initialFeedbackEnabled={document.feedbackEnabled} />
            )}

            {/* Only meaningful once the document's actually been published
                at least once — same reasoning as FeedbackManagement above. */}
            {canManageSharing && hasEverPublished && sharingAllowed(document) && (
              <ShareSettings documentId={document.id} initialShareEnabled={document.shareEnabled} />
            )}

            {folderControls.length > 0 && <DocumentFolderSettings documentId={document.id} teams={folderControls} />}

            {canEditAccess && (
              <AccessSettings
                documentId={document.id}
                initialVisibility={document.visibility}
                initialTeamIds={currentAccessTeamIds}
                teamOptions={teamOptions}
                canOpenToOrg={canOpenToOrg}
              />
            )}

            {showEveryoneRequest && (
              <EveryoneRequestPanel
                documentId={document.id}
                mode="request"
                pending={everyonePending}
                approverName={globalApproverName}
                canWithdraw={pendingEveryoneRequest?.requestedById === user.id}
                lastDecision={
                  latestEveryoneRequest && latestEveryoneRequest.status !== "pending"
                    ? {
                        approved: latestEveryoneRequest.status === "approved",
                        decidedByName: latestEveryoneRequest.decidedBy?.name ?? null,
                        comment: latestEveryoneRequest.decisionComment,
                        decidedAt: latestEveryoneRequest.decidedAt?.toISOString() ?? null,
                      }
                    : null
                }
              />
            )}

            {canEditDownloads && (
              <DownloadSettings
                documentId={document.id}
                initialDownloadable={document.downloadable}
              />
            )}

            {/* Explains why the replace icon isn't showing up top for a
                rejected document — otherwise the restriction (only the
                rejected version's own uploader can replace it) is invisible
                and just looks like the feature disappeared. */}
            {rejectedExplanationVisible && latestVersion && (
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-lavender text-ff-textMuted">
                  <Info className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ff-text">Replace Is Restricted</p>
                  <p className="text-xs text-ff-textMuted">
                    This document was rejected. Only <strong>{latestVersion.uploadedBy.name}</strong>, who uploaded
                    the rejected version, can replace it and resubmit for review.
                  </p>
                </div>
              </div>
            )}
          </div>
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
          canModerate={docRole === "manager" || docRole === "superadmin"}
          canTriage={canManageFeedback}
          feedbackEnabled={document.feedbackEnabled || leadershipComment}
          taggableUsers={taggableUsers}
          initialFeedback={feedback.map((f) => ({
            ...f,
            editedAt: f.editedAt?.toISOString() ?? null,
            replies: f.replies.map((r) => ({
              id: r.id,
              authorId: r.authorId,
              authorName: r.author.name,
              authorRole: r.author.role as Role,
              comment: r.comment,
              editedAt: r.editedAt?.toISOString() ?? null,
              createdAt: r.createdAt.toISOString(),
            })),
          }))}
        />
      ),
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <Link
          href="/dashboard"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ff-textMuted hover:text-ff-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Documents
        </Link>

        {/* Title row: just the identity, plus at most one badge — the one
            thing that actually needs attention right now. Everything else
            (category, permanent/review-due, the review-history lookup) is
            demoted to the quieter metadata line below, instead of competing
            with the title for the same visual weight. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <DocTypeIcon docType={document.docType} className="h-5 w-5 shrink-0 text-ff-textMuted" />
          <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight text-ff-text">{document.title}</h1>
          {/* What this viewer can and can't do here, one tap away. */}
          <InfoTooltip
            text={`You can ${youCan.join(", ")}.${youCannot.length ? ` You can't ${youCannot.join("; ")}.` : ""}`}
          />
          {/* A new version is awaiting a decision on a document that's
              already been published before — worded differently depending
              on who's looking: a manager/reviewer still has a decision to
              make, while the document's own uploader is just waiting on
              one. Jumps straight into the Review tab's status section. */}
          {hasEverPublished &&
            document.status === "pending_review" &&
            (docRole === "manager" || docRole === "superadmin" || document.uploadedById === user.id) && (
              <Badge
                variant="warning"
                solid
                pulse
                icon={<Clock className="h-3 w-3" aria-hidden />}
                tooltip="Go to the review section"
                href={`/dashboard/documents/${document.id}#review-status`}
              >
                {docRole === "manager" || docRole === "superadmin" ? "Waiting for review" : "Under review"}
              </Badge>
            )}
        </div>

        {/* Metadata line: who uploaded it and who's reviewing it, plus every static fact —
            category, permanent-flag or review-due, purge countdown — and,
            for a non-stakeholder, the public-safe Review History lookup.
            Same muted weight throughout, none of it competing with the
            title above. */}
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ff-textMuted">
          <span className="flex min-w-0 flex-wrap items-center gap-2 break-words">
            Uploaded by {document.uploadedBy.name} · {document.reviewBypassed ? "Published without review" : `Reviewer: ${document.owner.name}`}
            {canManageLifecycle && !isDeleted && document.status === "published" && effectiveCurrentVersion && (
              <CurrentVersionControl
                documentId={document.id}
                currentVersionNumber={effectiveCurrentVersion.versionNumber}
                currentVersionLabel={versionLabel(effectiveCurrentVersion.id, effectiveCurrentVersion.versionNumber)}
                versions={document.versions
                  .filter((v) => approvedVersionIds.has(v.id))
                  .map((v) => ({ id: v.id, versionNumber: v.versionNumber, label: versionLabel(v.id, v.versionNumber) }))}
              />
            )}
          </span>
          {!document.category.isSystem && <Badge variant="neutral">{document.category.name}</Badge>}
          {document.extraCategories.map((e) => (
            <Badge key={e.categoryId} variant="neutral" tooltip="Also listed in this category">
              {e.category.name}
            </Badge>
          ))}
          <AccessBadges
            visibility={document.visibility}
            teamNames={document.teamAccess.map((a) => a.team.name).sort()}
            reviewBypassed={document.reviewBypassed}
            downloadable={document.downloadable}
          />
          {document.neverExpires ? (
            <Badge variant="success">Permanent</Badge>
          ) : (
            !isDeleted &&
            document.status === "published" &&
            reviewDueInDays !== null && (
              <Badge variant={reviewDueInDays <= 0 ? "danger" : isReviewDueSoon ? "warning" : "neutral"}>
                {reviewDueInDays <= 0
                  ? "Review overdue"
                  : `Review due in ${reviewDueInDays} day${reviewDueInDays === 1 ? "" : "s"}`}
              </Badge>
            )
          )}
          {showPurgeCountdown && (
            <Badge variant="danger">
              Available for {Math.max(0, daysUntilPurge!)} more day{daysUntilPurge === 1 ? "" : "s"}
            </Badge>
          )}
          {/* A plain "user" (or a contributor who isn't this document's own
              uploader) is never a stakeholder, so never sees the full
              Review tab — but they can still reasonably want to know the
              cycle at a high level: which version, approved by whom. Opens
              a modal rather than navigating, showing only that (see
              ReviewHistoryModal.tsx's own comment for exactly what it
              deliberately leaves out — no rejected attempts, no comments).
              A stakeholder doesn't need this at all now: their own history
              is always one click away in the Review tab itself. */}
          {!isStakeholder && (
            <ReviewHistoryModal entries={approvalHistory.map((e) => ({ ...e, approvedAt: e.approvedAt?.toISOString() ?? null }))} />
          )}
        </div>


        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Secondary/admin actions — visually de-emphasized and grouped
                ahead of the primary action, separated by a divider, so the
                one thing most people came here to do (preview/download)
                stays the visual focus instead of competing with manager-only
                controls that only sometimes apply. */}
            {(canRestore || canUploadVersion || canDelete || canArchive || canUnarchive) && (
              <div className="flex flex-wrap items-center gap-1.5 border-r border-ff-border pr-2">
                {canRestore && <RestoreButton documentId={document.id} />}
                {canUploadVersion && !document.externalUrl && (
                  <UploadVersionForm
                    documentId={document.id}
                    isRejected={document.status === "rejected"}
                    canBypassReview={canBypassReviewFor(user, document.visibility, currentAccessTeamIds)}
                    restrictedToTeamIds={document.visibility === "restricted" ? currentAccessTeamIds : null}
                  />
                )}
                {(canArchive || canUnarchive) && (
                  <ArchiveButton documentId={document.id} archived={document.status === "archived"} />
                )}
                {canDelete && <DeleteButton documentId={document.id} title={document.title} permanent={deletePurges} />}
              </div>
            )}
            {!isDeleted && document.externalUrl && (
              <>
                <DocumentPreview documentId={document.id} docType={document.docType} externalUrl={document.externalUrl} />
                {/* isPubliclyVisible, not the raw document.status === "published"
                    check this used to have: a link document simply back in
                    re-review after already being published once must stay
                    shareable, same as the file-based branch below (which
                    gates on effectiveCurrentVersion, itself isPubliclyVisible-
                    aware) already does. */}
                {isPubliclyVisible && (document.shareEnabled && sharingAllowed(document) ? (
                  <ShareModal documentId={document.id} />
                ) : (
                  <SharingNotAllowedLabel teamOnly={!sharingAllowed(document)} />
                ))}
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
            {!isDeleted && effectiveCurrentVersion && (
              <>
                <DocumentPreview
                  documentId={document.id}
                  docType={document.docType}
                  extractedText={effectiveCurrentVersion.extractedText}
                  hasPreviewPdf={Boolean(effectiveCurrentVersion.previewPdfPath)}
                  previewOnly={previewOnly}
                />
                {document.shareEnabled && sharingAllowed(document) ? (
                  <ShareModal documentId={document.id} />
                ) : (
                  <SharingNotAllowedLabel teamOnly={!sharingAllowed(document)} />
                )}
                {/* No `versions`/currentVersionNumber here anymore — only
                    the current live version is ever downloadable, by
                    anyone, regardless of role. Older versions (including
                    the newest upload while it's still pending review) are
                    view-only now: reviewers/contributors look at them via
                    Preview while reviewing, not Download — see the matching
                    restriction in app/api/documents/[id]/download/route.ts. */}
                {previewOnly ? (
                  <span
                    title="Downloads are turned off for this document"
                    className="flex items-center gap-1.5 rounded-ff border border-ff-border bg-ff-lavender/40 px-4 py-2 text-sm text-ff-textMuted"
                  >
                    <EyeOff className="h-4 w-4" aria-hidden />
                    Preview only
                  </span>
                ) : (
                  <DownloadMenu
                    documentId={document.id}
                    hasPreviewPdf={Boolean(effectiveCurrentVersion.previewPdfPath)}
                    docType={document.docType}
                    variant="cta"
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* One shared spacing rhythm for every status banner, instead of
            each carrying its own independent mb-6 — up to four of these can
            stack at once (deleted/revoked/archived are mutually exclusive
            with each other, but duplicate and stale flags can join any of
            them). */}
        <div className="mb-6 space-y-2">
        {isDeleted && (
          <div className="rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            This document was deleted by {document.deletedBy?.name ?? "a manager"} on{" "}
            {document.deletedAt && <LocalDateTime value={document.deletedAt} />}. It will be permanently removed after the
            configured retention window (see Settings) unless restored.
          </div>
        )}

        {!isDeleted && document.status === "revoked" && (
          <div className="rounded-ff border border-ff-danger/40 bg-ff-danger/10 p-3 text-sm text-ff-text">
            Back in review{document.revokedBy && <>, sent by {document.revokedBy.name}</>}
            {document.revokedAt && <> on <LocalDateTime value={document.revokedAt} /></>}. Hidden from everyone
            until it&apos;s re-approved.
            {document.revokeReason && (
              <>
                {" "}
                <strong>Reason:</strong> {document.revokeReason}
              </>
            )}
          </div>
        )}

        {document.status === "archived" && (
          <div className="rounded-ff border border-ff-border bg-ff-lavender/40 p-3 text-sm text-ff-text">
            This document is archived and hidden from everyone. A manager can restore it, which sends it back for approval.
          </div>
        )}

        {document.duplicateOf && (
          <div className="rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3 text-sm text-ff-text">
            <strong>Possible duplicate:</strong> {document.duplicateReason}{" "}
            <Link href={`/dashboard/documents/${document.duplicateOf.id}`} className="text-ff-accent hover:underline">
              View &quot;{document.duplicateOf.title}&quot;
            </Link>
          </div>
        )}

        {document.stalenessFlags.length > 0 && (
          <div className="rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3 text-sm text-ff-text">
            <strong>Flagged as potentially outdated:</strong>
            <ul className="ml-4 mt-1 list-disc">
              {document.stalenessFlags.map((f) => <li key={f.id}>{f.reason}</li>)}
            </ul>
          </div>
        )}
        </div>

        {showEveryoneDecision && (
          <div className="mb-4">
            <EveryoneRequestPanel documentId={document.id} mode="decide" pending={everyonePending} />
          </div>
        )}

        <DocumentDetailTabs tabs={tabs} defaultTabKey="versions" />
        </div>
        <Footer />
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
              ? value === true ? "Yes" : value === false ? "No" : "N/A"
              : (value as string) || "N/A";
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

// Shown in place of the Share button once an approver (or a manager
// afterward, from the Manage tab's ShareSettings) has turned sharing off
// for this document (Document.shareEnabled) — so its absence reads as a
// deliberate decision rather than the control having silently disappeared.
function SharingNotAllowedLabel({ teamOnly = false }: { teamOnly?: boolean }) {
  return (
    <span
      title={teamOnly ? "Team documents stay inside the company." : "An approver or manager has turned off sharing for this document."}
      className="inline-flex items-center gap-1.5 rounded-full border border-ff-border bg-ff-lavender/40 px-3 py-1.5 text-xs font-medium text-ff-textMuted"
    >
      <Ban className="h-3.5 w-3.5" aria-hidden />
      Sharing this document is not allowed
    </span>
  );
}
