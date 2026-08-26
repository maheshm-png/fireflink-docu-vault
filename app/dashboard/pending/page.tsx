import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, XCircle, Archive } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { DocStatus } from "@prisma/client";
import Navbar from "@/components/Navbar";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import ViewToggle from "@/components/ViewToggle";

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

  // Personal queue for everyone, managers included — a document only shows
  // up here for someone who's either uploaded it (any version) or is/was an
  // assigned reviewer on it (any round, so it stays visible after they've
  // decided too, not just while pending). A manager who was never assigned
  // to a document has no more business seeing it here than an uninvolved
  // contributor would. Uploading a later version matters separately from
  // the original uploader because once a document's rejected, only whoever
  // uploaded that specific version can replace it (see canUploadVersion in
  // app/dashboard/documents/[id]/page.tsx) — that might not be the
  // document's original uploader, so they still need to be able to find it.
  const baseWhere = {
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
        // The latest version, not currentVersion — currentVersion is the
        // last *approved* file, which for a document sitting here because a
        // new version was just uploaded (pending_review) or rejected is the
        // previous, already-decided file, not the one actually awaiting a
        // decision. See components/DocumentTable.tsx's `version` prop.
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        reviewRequests: { select: { roundNumber: true, status: true, comments: true } },
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
      reviewRounds: doc.reviewRequests.map((r) => ({ roundNumber: r.roundNumber, status: r.status, comments: r.comments })),
    };
  });

  const tabHref = (status: string) => {
    const params = new URLSearchParams();
    if (status !== "pending_review") params.set("status", status);
    if (searchParams.view === "grid") params.set("view", "grid");
    const qs = params.toString();
    return qs ? `/dashboard/pending?${qs}` : "/dashboard/pending";
  };

  const SUBTITLES: Record<string, string> = {
    pending_review: isReviewer ? "Documents awaiting an approve/reject decision." : "Your submissions that are still awaiting review.",
    rejected: isReviewer ? "Submissions sent back with feedback." : "Your submissions that were sent back with feedback.",
    archived: "Documents retired from the public dashboard.",
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
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
      </main>
    </div>
  );
}
