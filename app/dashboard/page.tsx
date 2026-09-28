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
import DocumentFilters from "@/components/DocumentFilters";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import DocumentSections from "@/components/DocumentSections";
import AnnouncementTicker from "@/components/AnnouncementTicker";
import { NewDocumentsProvider } from "@/components/NewDocumentsProvider";
import { activeFilterCount, applyFilters, buildFilterOptions, schemaForSection, type FilterableDoc, type RawParams } from "@/lib/docFilters";
import { getSavedFilters } from "@/lib/savedFilters";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: RawParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const param = (key: string) => {
    const v = searchParams[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const categoryId = param("category");

  // Categories for the tab strip, with a published-doc count per category
  // so users can see volume before clicking. Counted from the search index
  // (see publishedCountsByCategory in lib/search.ts), the same source the
  // document list below reads from, so a tab's count always equals what it
  // lists.
  const [categories, countByCategoryId] = await Promise.all([
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
  //
  // Only "published" and the keyword go to Meilisearch. The category tab
  // and every custom filter (lib/docFilters.ts) are applied below against
  // the database: the index only knows each document's category by the
  // name it had when it was indexed, so filtering on that dropped every
  // document from a tab once its category was renamed. Most of what the
  // custom filters look at (owner, metadata, created date) isn't in the
  // index at all, and the unfiltered section is also what the filter
  // choices are built from.
  const filters: string[] = ['status = "published"'];
  const section = `published:${categories.some((c) => c.id === categoryId) ? categoryId : "all"}`;

  // Independent of each other — neither needs the other's result.
  const [unreadPublishedNotifications, results, savedFilters] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, type: "published", read: false },
      orderBy: { createdAt: "desc" },
      select: { documentId: true, documentTitle: true },
    }),
    // High limit: the default 25 cut off categories with more documents than
    // that (a tab reading 31 listed only 25).
    search(param("q"), filters, 1000),
    getSavedFilters(user.id, section),
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
    count: countByCategoryId.get(c.id) ?? 0,
  }));

  const view = param("view") === "grid" ? "grid" : "list";

  // Custom-field filters + Case Studies domain grouping are both driven by
  // the selected category's formSchema and the real metadata values present
  // on the documents in view (not the schema's declared options), so they
  // work the same for a dropdown field, free text, date, or number.
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const schema = schemaForSection(categories, selectedCategory?.id ?? null);

  // Manager/superadmin see this for ANY document (a decision they can make);
  // a contributor only sees it on their OWN uploads (something they're
  // waiting on) — same split as the "Waiting for review"/"Under review"
  // badge on the document detail page itself.
  const wantsPendingApproval =
    (user.role === "manager" || user.role === "superadmin" || user.role === "contributor") && rows.length > 0;

  // Independent of each other — both only need the row ids already in hand
  // from the search above — so they don't need to wait in sequence.
  const [pendingApproval, details] = await Promise.all([
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
    // What the custom filters need beyond the search hit itself.
    rows.length > 0
      ? prisma.document.findMany({
          where: { id: { in: rows.map((r) => r.id) }, deletedAt: null },
          select: {
            id: true,
            categoryId: true,
            category: { select: { name: true } },
            tags: true,
            metadata: true,
            createdAt: true,
            duplicateOfId: true,
            owner: { select: { name: true } },
          },
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

  const detailById = new Map(details.map((d) => [d.id, d]));
  // Category from the database, not the index (see the filters comment
  // above); also drops anything soft-deleted that's still indexed.
  rows = rows
    .filter((r) => {
      const d = detailById.get(r.id);
      return d !== undefined && (!selectedCategory || d.categoryId === selectedCategory.id);
    })
    .map((r) => ({ ...r, categoryName: detailById.get(r.id)!.category.name }));
  const metaOf = (id: string) => (detailById.get(id)?.metadata as Record<string, unknown> | undefined) ?? {};
  const filterable: FilterableDoc[] = rows.map((r) => {
    const d = detailById.get(r.id);
    return {
      id: r.id,
      title: r.title,
      tags: d?.tags ?? [],
      docType: r.docType,
      categoryId: d?.categoryId ?? "",
      categoryName: r.categoryName,
      uploadedByName: r.uploadedByName,
      ownerName: d?.owner.name ?? "",
      createdAt: d?.createdAt.toISOString() ?? r.updatedAt,
      updatedAt: r.updatedAt,
      isStale: r.isStale,
      isDuplicate: Boolean(d?.duplicateOfId || r.duplicateOfTitle),
      metadata: metaOf(r.id),
    };
  });
  const filterOptions = buildFilterOptions(filterable, schema, { withCategories: !selectedCategory, showStale: true });
  const keptIds = new Set(applyFilters(filterable, searchParams, schema, { keywordInMemory: false }).map((d) => d.id));
  rows = rows.filter((r) => keptIds.has(r.id));

  let domainGroups: { id: string; name: string; rows: DocRow[] }[] | null = null;
  if (selectedCategory?.name === "Case Studies") {
    const grouped = new Map<string, DocRow[]>();
    for (const r of rows) {
      const domain = (metaOf(r.id).domain as string)?.trim() || "Unspecified";
      if (!grouped.has(domain)) grouped.set(domain, []);
      grouped.get(domain)!.push(r);
    }
    domainGroups = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, domainRows]) => ({ id: domain, name: domain, rows: domainRows }));
  }

  const hasFilters = Boolean(categoryId || activeFilterCount(searchParams) > 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-ff-text">Published Documents</h1>
        <NewDocumentsProvider initialDocumentIds={newDocIds} initialRecentDocs={recentDocs}>
          <AnnouncementTicker />
          <CategoryTabs categories={categoryTabs} basePath="/dashboard" />
          <FilterBar canUpload={can(user.role, "upload")} showViewToggle>
            <DocumentFilters
              key={section}
              basePath="/dashboard"
              section={section}
              options={filterOptions}
              saved={savedFilters}
              keepKeys={["category", "view"]}
            />
          </FilterBar>

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
