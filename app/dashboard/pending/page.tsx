import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, XCircle, Archive } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { DocStatus } from "@prisma/client";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import ViewToggle from "@/components/ViewToggle";
import { computeRoundAttempts } from "@/lib/versionRounds";

// No "revoked" tab here — see app/dashboard/revoked/page.tsx instead, the
// org-wide view-only listing that superseded showing revoked docs in this
// (personal, per-user-scoped) queue.
const STATUS_TABS: { key: DocStatus; label: string; icon: typeof Clock }[] = [
  { key: "pending_review", label: "Pending", icon: Clock },
  { key: "rejected", label: "Rejected", icon: XCircle },
  { key: "archived", label: "Archived", icon: Archive },
];

export default async function ReviewDashboardPage({
  searchParams,
}: {
  searchParams: { status?: string; view?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The base "user" role can never upload (see lib/rbac.ts's "upload"
  // permission) or review, so this page can only ever show them an empty
  // queue — same reasoning as the nav link being hidden for them
  // (components/Navbar.tsx), just enforced here too rather than relying on
  // the link simply not being there.
  if (user.role === "user") redirect("/dashboard");

  const isReviewer = can(user.role, "approveReview");
  const activeStatus = STATUS_TABS.some((t) => t.key === searchParams.status)
    ? (searchParams.status as (typeof STATUS_TABS)[number]["key"])
    : "pending_review";

  // Personal queue for everyone except superadmin — a document only shows
  // up here for someone who's either uploaded it (any version) or is/was an
  // assigned reviewer on it (any round, so it stays visible after they've
  // decided too, not just while pending). A manager who was never assigned
  // to a document has no more business seeing it here than an uninvolved
  // contributor would. Uploading a later version matters separately from
  // the original uploader because once a document's rejected, only whoever
  // uploaded that specific version can replace it (see canUploadVersion in
  // app/dashboard/documents/[id]/page.tsx) — that might not be the
  // document's original uploader, so they still need to be able to find it.
  // Superadmin gets the org-wide picture instead: they're deliberately
  // excluded from ever being assigned as a reviewer (see approveReview in
  // lib/rbac.ts), so a personal-queue scope would leave this page
  // permanently empty for them even though nothing about their role limits
  // what they're allowed to SEE — same oversight reach they already have on
  // Deleted Documents and the audit log, just applied here too.
  const baseWhere =
    user.role === "superadmin"
      ? { deletedAt: null }
      : {
          deletedAt: null,
          OR: [
            { uploadedById: user.id },
            { versions: { some: { uploadedById: user.id } } },
            { reviewRequests: { some: { reviewerId: user.id } } },
          ],
        };

  const [docs, tabCounts] = await Promise.all([
    prisma.document.findMany({
      where: { status: activeStatus, ...baseWhere },
      include: {
        category: true,
        uploadedBy: true,
        duplicateOf: true,
        // Every version, not just the latest — lib/versionRounds.ts's
        // computeRoundAttempts (used below for each row's status-badge
        // hover detail) needs the full history to correctly map each
        // ReviewRequest round to its Round.Attempt label. Sorted
        // newest-first so versions[0] is still the latest for the existing
        // "which version is actually awaiting a decision" use below.
        versions: { orderBy: { versionNumber: "desc" } },
        // Only for building each row's status-badge hover detail (see
        // statusDetail below) — never rendered directly, so this stays a
        // lightweight select rather than the full round-history include the
        // Review Status stepper needs.
        reviewRequests: {
          select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewer: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.document.groupBy({
      by: ["status"],
      where: { status: { in: STATUS_TABS.map((t) => t.key) }, ...baseWhere },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map(tabCounts.map((c) => [c.status, c._count._all]));

  const rows: DocRow[] = docs.map((doc) => {
    const latestVersion = doc.versions[0];

    // What's actually happening right now, for the status badge's hover
    // detail — which round it's on, and who it's waiting on or was decided
    // by. Only pending_review/rejected carry anything worth explaining;
    // published/archived are already self-explanatory from the label alone.
    let statusDetail: string | undefined;
    if (doc.status === "pending_review" || doc.status === "rejected") {
      const roundAttempts = computeRoundAttempts(
        doc.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt })),
        doc.reviewRequests,
        doc.revokedAt
      );
      const maxRoundNumber = doc.reviewRequests.length > 0 ? Math.max(...doc.reviewRequests.map((r) => r.roundNumber)) : null;
      const round = maxRoundNumber !== null ? roundAttempts.byRoundNumber.get(maxRoundNumber)?.round ?? maxRoundNumber : null;
      if (doc.status === "pending_review") {
        const pendingReviewers = [...new Set(doc.reviewRequests.filter((r) => r.status === "pending").map((r) => r.reviewer.name))];
        statusDetail =
          round !== null
            ? `Round ${round}, waiting on ${pendingReviewers.length > 0 ? pendingReviewers.join(", ") : "a reviewer"}.`
            : undefined;
      } else {
        // The row that actually rejected it (not one auto-closed by a
        // different reviewer's rejection — see app/api/documents/[id]/
        // review/route.ts's reject handling), most recent first.
        const rejectedBy = [...doc.reviewRequests]
          .filter((r) => r.status === "rejected" && !r.comments?.startsWith("Auto-closed:"))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        statusDetail =
          round !== null && rejectedBy
            ? `Round ${round}, rejected by ${rejectedBy.reviewer.name}${rejectedBy.comments ? `: "${rejectedBy.comments}"` : "."}`
            : undefined;
      }
    }

    return {
      id: doc.id,
      title: doc.title,
      categoryName: doc.category.name,
      docType: doc.docType,
      status: doc.status,
      uploadedByName: doc.uploadedBy.name,
      updatedAt: doc.updatedAt.toISOString(),
      isStale: false,
      duplicateOfTitle: doc.duplicateOf?.title ?? null,
      extractedText: latestVersion?.extractedText ?? null,
      hasCurrentVersion: latestVersion !== undefined,
      hasPreviewPdf: Boolean(latestVersion?.previewPdfPath),
      version: latestVersion?.versionNumber,
      externalUrl: doc.externalUrl,
      statusDetail,
    };
  });

  const tabHref = (status: string) => {
    const params = new URLSearchParams();
    if (status !== "pending_review") params.set("status", status);
    if (searchParams.view === "grid") params.set("view", "grid");
    const qs = params.toString();
    return qs ? `/dashboard/pending?${qs}` : "/dashboard/pending";
  };

  const SUBTITLES: Record<string, string> =
    user.role === "superadmin"
      ? {
          pending_review: "Every document across the org awaiting an approve/reject decision.",
          rejected: "Every submission across the org sent back with feedback.",
          archived: "Every document retired from the public dashboard.",
        }
      : {
          pending_review: isReviewer ? "Documents awaiting an approve/reject decision." : "Your submissions that are still awaiting review.",
          rejected: isReviewer ? "Submissions sent back with feedback." : "Your submissions that were sent back with feedback.",
          archived: "Documents retired from the public dashboard.",
        };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Review Dashboard</h1>
        <p className="mb-4 text-sm text-ff-textMuted">{SUBTITLES[activeStatus]}</p>

        <div className="mb-6 grid grid-cols-3 gap-4">
          {STATUS_TABS.map((t) => {
            const isActive = t.key === activeStatus;
            const Icon = t.icon;
            return (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex flex-col gap-3 rounded-ff border bg-white p-5 shadow-ff transition-all hover:-translate-y-0.5 hover:shadow-ff-md ${
                  isActive ? "border-ff-accent/50 ring-1 ring-ff-accent/30" : "border-ff-border hover:border-ff-accent/30"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-ff ${
                    isActive ? "bg-ff-accent-gradient text-white" : "bg-ff-lavender text-ff-accent"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <p className="text-2xl font-semibold text-ff-text">{countByStatus.get(t.key) ?? 0}</p>
                  <p className="text-sm text-ff-textMuted">{t.label}</p>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mb-4 flex justify-end">
          <ViewToggle basePath="/dashboard/pending" />
        </div>

        {searchParams.view === "grid" ? <DocumentGrid rows={rows} /> : <DocumentTable rows={rows} />}
        </div>
        <Footer />
      </main>
    </div>
  );
}
