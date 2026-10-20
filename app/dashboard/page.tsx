import Link from "next/link";
import { Globe, Lock } from "lucide-react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Pagination from "@/components/Pagination";
import { PAGE_SIZE_COOKIE, resolvePage, resolvePageSize } from "@/lib/pagination";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { search, publishedCountsByCategory, withAccessFilter } from "@/lib/search";
import { documentAccessWhere } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import InfoTooltip from "@/components/InfoTooltip";
import FilterBar from "@/components/FilterBar";
import CategoryTabs from "@/components/CategoryTabs";
import DocumentFilters from "@/components/DocumentFilters";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import DocumentSections from "@/components/DocumentSections";
import AnnouncementTicker from "@/components/AnnouncementTicker";
import CategoryIcon from "@/components/CategoryIcon";
import LiveNewCategoryBadge from "@/components/LiveNewCategoryBadge";
import { NewDocumentsProvider } from "@/components/NewDocumentsProvider";
import { activeFilterCount, applyFilters, buildFilterOptions, schemaForSection, type FilterableDoc, type RawParams } from "@/lib/docFilters";
import { getSavedFilters } from "@/lib/savedFilters";
import { newDocumentsFor } from "@/lib/newDocuments";
import TeamSpaceView from "./TeamSpaceView";

// Quick-access tile colors, cycled by position. Full class strings so
// Tailwind keeps them.
const TILE_COLORS = [
  { tile: "border-violet-200 bg-violet-50 hover:border-violet-400", icon: "bg-violet-500 text-white" },
  { tile: "border-sky-200 bg-sky-50 hover:border-sky-400", icon: "bg-sky-500 text-white" },
  { tile: "border-emerald-200 bg-emerald-50 hover:border-emerald-400", icon: "bg-emerald-500 text-white" },
  { tile: "border-amber-200 bg-amber-50 hover:border-amber-400", icon: "bg-amber-500 text-white" },
  { tile: "border-rose-200 bg-rose-50 hover:border-rose-400", icon: "bg-rose-500 text-white" },
  { tile: "border-teal-200 bg-teal-50 hover:border-teal-400", icon: "bg-teal-500 text-white" },
  { tile: "border-indigo-200 bg-indigo-50 hover:border-indigo-400", icon: "bg-indigo-500 text-white" },
  { tile: "border-orange-200 bg-orange-50 hover:border-orange-400", icon: "bg-orange-500 text-white" },
];

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

  // Home has two views: documents for Everyone (default) and "My teams"
  // (?space=teams), the confidential documents of the viewer's teams. The
  // separate Team Space page was merged in here.
  if (param("space") === "teams") {
    return (
      <HomeShell user={user} space="teams">
        <TeamSpaceView user={user} searchParams={searchParams} />
      </HomeShell>
    );
  }

  // Categories for the tab strip, with a published-doc count per category
  // so users can see volume before clicking. Counted from the search index
  // (see publishedCountsByCategory in lib/search.ts), the same source the
  // document list below reads from, so a tab's count always equals what it
  // lists.
  const [categories, countByCategoryId] = await Promise.all([
    prisma.category.findMany({ where: { isSystem: false }, orderBy: { name: "asc" } }),
    publishedCountsByCategory(user),
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
  // Home's Everyone view lists documents visible to everyone only.
  // Restricted (team-only) documents live in the My teams view, so the two never mix; a search here still
  // says how many team-only documents match (teamSpaceMatches below).
  // `!= "restricted"` (not `= "org"`) so documents indexed before team
  // access existed, which have no visibility field, still show.
  const filters: string[] = ['status = "published"', 'visibility != "restricted"'];
  const section = `published:${categories.some((c) => c.id === categoryId) ? categoryId : "all"}`;

  // Independent of each other — neither needs the other's result.
  // "New" notices for this section only: documents for everyone (team
  // documents show theirs inside My teams, lib/newDocuments.ts).
  const [newDocs, results, savedFilters] = await Promise.all([
    newDocumentsFor(user, { kind: "everyone" }),
    // High limit: the default 25 cut off categories with more documents than
    // that (a tab reading 31 listed only 25).
    search(param("q"), withAccessFilter(user, filters), 1000),
    getSavedFilters(user.id, section),
  ]);
  const newDocIds = newDocs.documentIds;
  const recentDocs = newDocs.recentDocs;
  const newCategoryIds = newDocs.categoryIds;

  // A search on Home also counts matching team-only documents, so nobody
  // concludes a document doesn't exist when it's in My teams.
  let teamSpaceMatches = 0;
  if (param("q")) {
    const restrictedHits = await search(
      param("q"),
      withAccessFilter(user, ['status = "published"', 'visibility = "restricted"']),
      1000
    );
    const ids = (restrictedHits.hits as unknown as { id: string }[]).map((h) => h.id);
    teamSpaceMatches = ids.length
      ? await prisma.document.count({
          where: { AND: [{ id: { in: ids }, deletedAt: null, visibility: "restricted" }, documentAccessWhere(user)] },
        })
      : 0;
  }

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
          // documentAccessWhere here too, not just in the search filter: a
          // row only survives below if it's in this result, so a stale
          // search index can never surface a document this user can't see.
          where: { AND: [{ id: { in: rows.map((r) => r.id) }, deletedAt: null, visibility: "org" }, documentAccessWhere(user)] },
          select: {
            id: true,
            visibility: true,
            reviewBypassed: true,
            downloadable: true,
            teamAccess: { select: { team: { select: { name: true } } } },
            categoryId: true,
            extraCategories: { select: { categoryId: true } },
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
      // Its main category, or one it's also shown in.
      return (
        d !== undefined &&
        (!selectedCategory || d.categoryId === selectedCategory.id || d.extraCategories.some((e) => e.categoryId === selectedCategory.id))
      );
    })
    .map((r) => {
      const d = detailById.get(r.id)!;
      return {
        ...r,
        categoryName: d.category.name,
        visibility: d.visibility,
        reviewBypassed: d.reviewBypassed,
        downloadable: d.downloadable,
        accessTeamNames: d.teamAccess.map((a) => a.team.name).sort(),
      };
    });
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
  const filterOptions = buildFilterOptions(filterable, schema, { withCategories: !selectedCategory, showStale: false });
  const keptIds = new Set(applyFilters(filterable, searchParams, schema, { keywordInMemory: false }).map((d) => d.id));
  rows = rows.filter((r) => keptIds.has(r.id));

  // Pagination: filters run over every match first, then one page is shown.
  const totalRows = rows.length;
  const perPage = resolvePageSize(param("per"), cookies().get(PAGE_SIZE_COOKIE)?.value);
  const page = resolvePage(param("page"), totalRows, perPage);
  rows = rows.slice((page - 1) * perPage, page * perPage);

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
  // Landing view (no category picked, no filters): quick-access category
  // tiles come first, the full list follows below. Once a category or filter
  // is chosen, the category tabs take over and the tiles step aside.
  const isLanding = !hasFilters && page === 1;

  return (
    <HomeShell user={user} space="everyone">
        <NewDocumentsProvider initialDocumentIds={newDocIds} initialCategoryIds={newCategoryIds} initialRecentDocs={recentDocs} scopeQuery="scope=everyone">
          <AnnouncementTicker />
          {isLanding ? (
            <section className="mb-8">
              <h2 className="mb-3 text-base font-bold text-ff-text">Quick access</h2>
              {categories.length === 0 ? (
                <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
                  No categories yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {categoryTabs.map((c, i) => {
                    const color = TILE_COLORS[i % TILE_COLORS.length];
                    return (
                      <Link
                        key={c.id}
                        href={`/dashboard?category=${c.id}`}
                        className={`relative flex items-center gap-3 rounded-ff border px-3 py-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-ff ${color.tile}`}
                      >
                        <LiveNewCategoryBadge categoryId={c.id} className="absolute -right-1.5 -top-1.5" />
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-ff ${color.icon}`}>
                          <CategoryIcon name={c.name} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ff-text" title={c.name}>
                            {c.name}
                          </p>
                          <p className="text-xs text-ff-textMuted">
                            {c.count} document{c.count === 1 ? "" : "s"}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              <h2 className="mb-3 mt-8 text-base font-bold text-ff-text">All published documents</h2>
            </section>
          ) : (
            <CategoryTabs categories={categoryTabs} basePath="/dashboard" />
          )}
          {teamSpaceMatches > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-ff border border-ff-accent/30 bg-ff-accent/5 px-3 py-2 text-sm text-ff-text">
              <span>
                {teamSpaceMatches} team-only document{teamSpaceMatches === 1 ? " also matches" : "s also match"} &quot;{param("q")}&quot;.
              </span>
              <Link
                href={`/dashboard?space=teams&q=${encodeURIComponent(param("q"))}`}
                className="font-medium text-ff-accent hover:underline"
              >
                See them in My teams
              </Link>
            </div>
          )}
          <FilterBar
            canUpload={can(user.role, "upload")}
            uploadHref={`/dashboard/upload?for=everyone${selectedCategory ? `&category=${selectedCategory.id}` : ""}`}
            uploadLabel="Upload for everyone"
            showViewToggle
          >
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
          <Pagination page={page} perPage={perPage} total={totalRows} />
        </NewDocumentsProvider>
    </HomeShell>
  );
}

type ShellUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Page frame shared by Home's two views, with the Everyone | My teams switch. */
function HomeShell({ user, space, children }: { user: ShellUser; space: "everyone" | "teams"; children: React.ReactNode }) {
  const views = [
    { key: "everyone", label: "Everyone", href: "/dashboard", icon: Globe },
    { key: "teams", label: "My teams", href: "/dashboard?space=teams", icon: Lock },
  ] as const;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
                Welcome, {user.name.split(" ")[0]}
                <InfoTooltip
                  text={
                    space === "everyone"
                      ? "Everyone: documents everyone in FireFlink can see."
                      : "My teams: confidential documents of your teams. Only your teams can see them."
                  }
                />
              </h1>
            </div>
            <div className="flex gap-1 rounded-ff border border-ff-border bg-ff-lavender/40 p-0.5 text-sm" role="tablist">
              {views.map((v) => (
                <Link
                  key={v.key}
                  href={v.href}
                  role="tab"
                  aria-selected={space === v.key}
                  className={`flex items-center gap-1.5 rounded-ff px-3 py-1.5 ${
                    space === v.key ? "bg-white font-medium text-ff-text shadow-sm" : "text-ff-textMuted hover:text-ff-text"
                  }`}
                >
                  <v.icon className="h-3.5 w-3.5" aria-hidden />
                  {v.label}
                </Link>
              ))}
            </div>
          </div>
          {children}
        </div>
        <Footer />
      </main>
    </div>
  );
}
