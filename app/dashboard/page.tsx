import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { search } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
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
  // so users can see volume before clicking — fetched via Prisma directly
  // rather than the /api/categories route, since we need the groupBy too.
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { status: "published", deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  // Seeds NewDocumentsProvider below — this user's own unread "published"
  // notifications (the same per-user, dismissible record the bell already
  // uses), not a raw recent-documents query. That means a document only
  // ever counts as "new" if its approving manager actually chose "announce
  // to all" (see app/api/documents/[id]/review/route.ts). The provider
  // polls /api/notifications/new-documents from here on, so opening a
  // document actually clears its NEW badge/ticker entry without a refresh —
  // see components/NewDocumentsProvider.tsx.
  const unreadPublishedNotifications = await prisma.notification.findMany({
    where: { userId: user.id, type: "published", read: false },
    orderBy: { createdAt: "desc" },
    select: { documentId: true, documentTitle: true },
  });
  const newDocIds = unreadPublishedNotifications.map((n) => n.documentId).filter((id): id is string => id !== null);
  const recentDocs = unreadPublishedNotifications
    .slice(0, 5)
    .filter((n): n is { documentId: string; documentTitle: string | null } => n.documentId !== null)
    .map((n) => ({ id: n.documentId, title: n.documentTitle ?? "Untitled document" }));

  const filters: string[] = ['status = "published"'];
  if (searchParams.category) {
    // CategoryTabs passes the category id, but Meilisearch only has the
    // category's name indexed (categoryName) — resolve id -> name here.
    const categoryName = categories.find((c) => c.id === searchParams.category)?.name;
    if (categoryName) filters.push(`categoryName = "${categoryName}"`);
  }
  if (searchParams.docType) filters.push(`docType = "${searchParams.docType}"`);
  if (searchParams.stale === "true") filters.push(`isStale = true`);

  const results = await search(searchParams.q ?? "", filters);
  let rows = results.hits as unknown as DocRow[];
  const categoryTabs = categories.map((c) => ({
    id: c.id,
    name: c.name,
    count: countByCategory.get(c.id) ?? 0,
  }));

  const view = searchParams.view === "grid" ? "grid" : "list";

  // Custom-field filtering + Case Studies domain grouping — both driven by
  // the selected category's formSchema and the real metadata values present
  // on the documents currently in view (not the schema's declared options),
  // so it works the same for a dropdown field, free text, date, or number.
  const selectedCategory = categories.find((c) => c.id === searchParams.category);
  const schema = (selectedCategory?.formSchema as unknown as CategoryFormField[] | undefined) ?? [];
  const filterableFieldDefs = schema.filter((f) => f.type !== "textarea");

  let filterableFields: FilterableField[] = [];
  let domainGroups: { id: string; name: string; rows: DocRow[] }[] | null = null;
  let activeFieldFilterCount = 0;

  if (selectedCategory && rows.length > 0 && filterableFieldDefs.length > 0) {
    const metas = await prisma.document.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, metadata: true },
    });
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
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
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
      </main>
    </div>
  );
}
