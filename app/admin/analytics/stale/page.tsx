import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import ViewToggle from "@/components/ViewToggle";

// Drill-down for the Analytics page's "Flagged Outdated" tile — documents
// with at least one unresolved StalenessFlag (see scripts/run-staleness-
// check.ts). Deliberately reads directly from Prisma rather than the
// Published-Documents search index: that index's isStale field is
// hardcoded false at every indexing call site and never actually flipped
// true anywhere, so filtering the search index on it would silently return
// nothing — the staleness data only really lives in the StalenessFlag table.
export default async function StaleDocumentsPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "viewAuditLog")) redirect("/dashboard");

  const docs = await prisma.document.findMany({
    where: { deletedAt: null, stalenessFlags: { some: { resolved: false } } },
    include: {
      category: true,
      uploadedBy: true,
      currentVersion: true,
      stalenessFlags: { where: { resolved: false } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows: DocRow[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    categoryName: doc.category.name,
    docType: doc.docType,
    status: doc.status,
    uploadedByName: doc.uploadedBy.name,
    updatedAt: doc.updatedAt.toISOString(),
    isStale: true,
    hasCurrentVersion: doc.currentVersion !== null,
    hasPreviewPdf: Boolean(doc.currentVersion?.previewPdfPath),
    externalUrl: doc.externalUrl,
    note: doc.stalenessFlags.map((f) => f.reason).join("; "),
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ff-text">Flagged Outdated</h1>
          <ViewToggle basePath="/admin/analytics/stale" />
        </div>
        <p className="mb-4 text-sm text-ff-textMuted">
          Documents flagged as possibly stale by the daily review-cycle and content checks.
        </p>
        {searchParams.view === "grid" ? <DocumentGrid rows={rows} /> : <DocumentTable rows={rows} />}
        </div>
      </main>
    </div>
  );
}
