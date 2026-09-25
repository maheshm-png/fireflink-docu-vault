import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { search, publishedCountsByCategory } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import { withoutDeletedDocuments } from "@/lib/notifications";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FilterBar from "@/components/FilterBar";
import CategoryTabs from "@/components/CategoryTabs";
import CategoryFieldFilters, { type FilterableField } from "@/components/CategoryFieldFilters";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import DocumentSections from "@/components/DocumentSections";
import AnnouncementTicker from "@/components/AnnouncementTicker";
import { NewDocumentsProvider } from "@/components/NewDocumentsProvider";
import type { CategoryFormField } from "@/lib/formSchema";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Categories for the tab strip, with a published-doc count per category
  // so users can see volume before clicking. Counted from the search index
  // (see publishedCountsByCategory in lib/search.ts), the same source the
  // document list below reads from, so a tab's count always equals what it
  // lists.
  const [categories, countByCategoryName] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    publishedCountsByCategory(),
  ]);

  // Seeds NewDocumentsProvider below — this user's own unread "published"
  // notifications (the same per-user, dismissible record the bell already
  // uses), not a raw recent-documents query. That means a document only
  // ever counts as "new" if its approving manager actually chose "announce
  // to all" (see app/api/documents/[id]/review/route.ts). The provider
  // polls /api/notifications/new-documents from here on, so opening a
  // document actually clears its NEW badge/ticker entry without a refresh —
  // see components/NewDocumentsProvider.tsx.
  const filters: string[] = ['status = "published"'];
  if (searchParams.category) {
    // CategoryTabs passes the category id, but Meilisearch only has the
    // category's name indexed (categoryName) — resolve id -> name here.
    const categoryName = categories.find((c) => c.id === searchParams.category)?.name;
    if (categoryName) filters.push(`categoryName = "${categoryName}"`);
  }
  if (searchParams.docType) filters.push(`docType = "${searchParams.docType}"`);
  if (searchParams.stale === "true") filters.push(`isStale = true`);

  // Independent of each other — neither needs the other's result.
  const [unreadPublishedNotifications, results] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, type: "published", read: false },
      orderBy: { createdAt: "desc" },
      select: { documentId: true, documentTitle: true },
    }),
    // High limit: the default 25 cut off categories with more documents than
    // that (a tab reading 31 listed only 25).
    search(searchParams.q ?? "", filters, 1000),
  ]);
  const liveUnreadPublished = await withoutDeletedDocuments(unreadPublishedNotifications);
  const newDocIds = liveUnreadPublished.map((n) => n.documentId).filter((id): id is string => id !== null);
  const recentDocs = liveUnreadPublished
    .slice(0, 5)
    .filter((n): n is { documentId: string; documentTitle: string | null } => n.documentId !== null)
    .map((n) => ({ id: n.documentId, title: n.documentTitle ?? "Untitled document" }));

  let rows = results.hits as unknown as DocRow[];

  const categoryTabs = categories.map((c) => ({
    id: c.id,
    name: c.name,
    count: countByCategoryName.get(c.name) ?? 0,
  }));

  const view = searchParams.view === "grid" ? "grid" : "list";

  // Custom-field filtering + Case Studies domain grouping — both driven by
  // the selected category's formSchema and the real metadata values present
  // on the documents currently in view (not the schema's declared options),
  // so it works the same for a dropdown field, free text, date, or number.
  const selectedCategory = categories.find((c) => c.id === searchParams.category);
  const schema = (selectedCategory?.formSchema as unknown as CategoryFormField[] | undefined) ?? [];
  const filterableFieldDefs = schema.filter((f) => f.type !== "textarea");

  // Manager/superadmin see this for ANY document (a decision they can make);
  // a contributor only sees it on their OWN uploads (something they're
  // waiting on) — same split as the "Waiting for review"/"Under review"
  // badge on the document detail page itself.
  const wantsPendingApproval =
    (user.role === "manager" || user.role === "superadmin" || user.role === "contributor") && rows.length > 0;
  const wantsMetas = Boolean(selectedCategory) && rows.length > 0 && filterableFieldDefs.length > 0;

  // Independent of each other — both only need the row ids already in hand
  // from the search above — so they don't need to wait in sequence.
  const [pendingApproval, metas] = await Promise.all([
    wantsPendingApproval
      ? prisma.document.findMany({
          // Flags rows that look "published" here (the search index still
          // shows their prior approved content — see app/dashboard/documents/
          // [id]/page.tsx's isPubliclyVisible comment for why) but actually
          // have a NEW version sitting in an active review round right now —
          // worth a manager/reviewer's attention even while just browsing,
          // without dragging them into full review mode the way opening the
          // document itself would (see DocumentTable.tsx/DocumentGrid.tsx's
          // blinking badge). Skipped entirely for anyone else — this is a
          // manager-tier or own-upload heads-up, not a signal a base "user"
          // viewer needs.
          where: { id: { in: rows.map((r) => r.id) }, status: "pending_review", currentVersionId: { not: null } },
          select: { id: true, uploadedById: true },
        })
      : Promise.resolve([]),
    wantsMetas
      ? prisma.document.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          select: { id: true, metadata: true },
        })
      : Promise.resolve([]),
  ]);

  if (wantsPendingApproval) {
    const isManagerTier = user.role === "manager" || user.role === "superadmin";
    const pendingApprovalIds = new Set(
      pendingApproval.filter((d) => isManagerTier || d.uploadedById === user.id).map((d) => d.id)
    );
    rows = rows.map((r) => ({ ...r, hasPendingApproval: pendingApprovalIds.has(r.id) }));
  }

  let filterableFields: FilterableField[] = [];
  let domainGroups: { id: string; name: string; rows: DocRow[] }[] | null = null;
  let activeFieldFilterCount = 0;

  if (wantsMetas && selectedCategory) {
    const metaById = new Map(metas.map((m) => [m.id, (m.metadata as Record<string, unknown>) ?? {}]));
    const displayValue = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? ""));

    filterableFields = filterableFieldDefs
      .map((f) => {
        const values = new Set<string>();
        for (const m of metaById.values()) {
          const v = m[f.id];
          if (v === undefined || v === null || v === "") continue;
          values.add(displayValue(v));
        }
        return { id: f.id, label: f.label, values: [...values].sort() };
      })
      .filter((f) => f.values.length > 1);

    const activeFieldFilters = filterableFieldDefs
      .map((f) => ({ id: f.id, value: searchParams[`f_${f.id}`] }))
      .filter((x): x is { id: string; value: string } => Boolean(x.value));
    activeFieldFilterCount = activeFieldFilters.length;

    if (activeFieldFilters.length > 0) {
      rows = rows.filter((r) => {
        const m = metaById.get(r.id) ?? {};
        return activeFieldFilters.every(({ id, value }) => displayValue(m[id]) === value);
      });
    }

    if (selectedCategory.name === "Case Studies") {
      const grouped = new Map<string, DocRow[]>();
      for (const r of rows) {
        const m = metaById.get(r.id) ?? {};
        const domain = (m.domain as string)?.trim() || "Unspecified";
        if (!grouped.has(domain)) grouped.set(domain, []);
        grouped.get(domain)!.push(r);
      }
      domainGroups = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, domainRows]) => ({ id: domain, name: domain, rows: domainRows }));
    }
  }

  const hasFilters = Boolean(
    searchParams.q || searchParams.category || searchParams.docType || searchParams.stale || activeFieldFilterCount > 0
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-ff-text">Published Documents</h1>
        <NewDocumentsProvider initialDocumentIds={newDocIds} initialRecentDocs={recentDocs}>
          <AnnouncementTicker />
          <CategoryTabs categories={categoryTabs} basePath="/dashboard" />
          <FilterBar canUpload={can(user.role, "upload")} showViewToggle />
          <CategoryFieldFilters basePath="/dashboard" fields={filterableFields} />

          {domainGroups ? (
            <DocumentSections groups={domainGroups} view={view} hasFilters={hasFilters} />
          ) : view === "grid" ? (
            <DocumentGrid rows={rows} hasFilters={hasFilters} />
          ) : (
            <DocumentTable rows={rows} hasFilters={hasFilters} />
          )}
        </NewDocumentsProvider>
        </div>
        <Footer />
      </main>
    </div>
  );
}
