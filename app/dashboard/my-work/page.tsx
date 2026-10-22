import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Upload, History, Search, FileText, Layers, Download, Globe, Users, Link2 } from "lucide-react";
import SharedLinksTable from "@/components/SharedLinksTable";
import { shareActivityFor, type ShareActivitySummary } from "@/lib/shareTracking";
import type { DocStatus, Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { canUploadSomething, decidesEveryoneRequests, documentAccessWhere, downloadsAllowed, hasMyWork, managesAnyTeam } from "@/lib/access";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import InfoTooltip from "@/components/InfoTooltip";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import DocumentSections from "@/components/DocumentSections";
import FilterBar from "@/components/FilterBar";
import DocumentFilters from "@/components/DocumentFilters";
import AccessBadges from "@/components/AccessBadges";
import { filterDocs, type RawParams } from "@/lib/docFilters";
import type { Involvement } from "@/components/DocumentTable";
import { getSavedFilters } from "@/lib/savedFilters";

// My Work: one personal page for contributors and managers to track what
// they're responsible for.
//   review   - documents waiting on MY decision (managers), including team
//              documents whose "Request for Everyone" waits on me as the
//              Global approver
//   uploads  - documents I uploaded, or uploaded a version of, in any status
//   reviewed - documents I approved or rejected (rows auto-closed by another
//              reviewer's rejection don't count as my decision)
//   all      - everything I'm involved in (uploaded, a version of, or was a
//              reviewer on); every document for a superadmin, who can't be
//              a reviewer. This replaced the old Review Dashboard
//              (/dashboard/pending now redirects here).
// A status filter (?status=) narrows any tab to In review / Published /
// Rejected / Archived.
// Plus a quick finder (?find=) over every document the viewer can see
// (lib/access.ts), to jump straight to a document and manage it.
// A scope switch (?scope=) splits every tab into Everyone (visibility org)
// and Team (restricted team documents). Everyone also has
//   downloads - documents I downloaded, and where to find them
//   shared    - share links I made or on my documents, with whether they
//               were opened (lib/shareTracking.ts), on the Everyone side
type Tab = "review" | "uploads" | "reviewed" | "all" | "downloads" | "shared";
type Scope = "everyone" | "team";

const STATUS_FILTERS: { key: DocStatus; label: string }[] = [
  { key: "pending_review", label: "In review" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
];
// "In review" also covers documents back in review after a restore from the
// archive (status "revoked"), so there's one review filter, not two.
const statusesFor = (key: DocStatus): DocStatus[] => (key === "pending_review" ? ["pending_review", "revoked"] : [key]);

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review",
  published: "Published",
  archived: "Archived",
  rejected: "Rejected",
  revoked: "Back in review",
};

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: RawParams & { tab?: string; view?: string; find?: string; status?: string; scope?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // The base "user" role neither uploads nor reviews (lib/rbac.ts), same as
  // the hidden nav link (components/Navbar.tsx), unless a team role gives
  // them work here.
  if (!hasMyWork(user)) redirect("/dashboard");

  const isSuperadmin = user.role === "superadmin";
  const decidesEveryone = decidesEveryoneRequests(user);

  // Two sides, each driven by its own roles (lib/access.ts):
  //   Everyone - the org role (User.role) decides who uploads and reviews
  //              documents for everyone; the Global approver also decides
  //              Requests for Everyone here.
  //   Team     - team roles (UserTeam.role): contributors upload, managers
  //              review. Shown to anyone in a team or with a team view, the
  //              Global approver, and anyone already involved in a team
  //              document (e.g. an org contributor who uploaded into one).
  const teamSideByRole =
    isSuperadmin || user.teamIds.length > 0 || user.viewTeamIds.length > 0 || user.seesAllTeams || decidesEveryone;
  const hasTeamSide =
    teamSideByRole ||
    (await prisma.document.count({
      where: {
        deletedAt: null,
        visibility: "restricted",
        OR: [
          { uploadedById: user.id },
          { versions: { some: { uploadedById: user.id } } },
          { reviewRequests: { some: { reviewerId: user.id } } },
        ],
      },
    })) > 0;
  // The base org role has nothing of its own on the Everyone side, so a team
  // contributor/manager lands on Team first.
  const defaultScope: Scope = user.role === "user" && hasTeamSide ? "team" : "everyone";
  const scope: Scope =
    searchParams.scope === "team" && hasTeamSide ? "team" : searchParams.scope === "everyone" ? "everyone" : defaultScope;

  const reviews = scope === "everyone" ? can(user.role, "approveReview") || decidesEveryone : managesAnyTeam(user) || decidesEveryone;
  const uploads = scope === "everyone" ? can(user.role, "upload") : canUploadSomething(user);
  const scopeRole =
    scope === "everyone"
      ? `${ROLE_LABELS[user.role]}${decidesEveryone ? ", Global approver" : ""}`
      : user.team?.name ?? (isSuperadmin ? "Superadmin, all teams" : decidesEveryone ? "Global approver" : "Not in a team");
  const allTab = {
    key: "all" as const,
    label: isSuperadmin ? "All documents" : "Everything I'm in",
    hint: isSuperadmin
      ? "Every document across the organization, in any status."
      : "Every document you're part of, grouped by how you're involved. Hover a status to see where it stands for you.",
    icon: Layers,
  };
  const tabs: { key: Tab; label: string; hint: string; icon: typeof Upload }[] = [
    ...(isSuperadmin ? [allTab] : []),
    ...(reviews
      ? [{ key: "review" as const, label: "Waiting on me", hint: "Documents assigned to you for a decision.", icon: ClipboardCheck }]
      : []),
    ...(uploads
      ? [{ key: "uploads" as const, label: "My uploads", hint: "Everything you uploaded, or uploaded a new version of.", icon: Upload }]
      : []),
    ...(reviews
      ? [{ key: "reviewed" as const, label: "Reviewed by me", hint: "Documents you approved or rejected.", icon: History }]
      : []),
    ...(isSuperadmin ? [] : [allTab]),
    { key: "downloads", label: "My downloads", hint: "Documents you downloaded, and where to find them.", icon: Download },
    ...(scope === "everyone"
      ? [{
          key: "shared" as const,
          label: "Shared links",
          hint: isSuperadmin
            ? "Every share link in the organization: whether it was opened, and change or stop it."
            : "Links you shared, and links to your documents: whether they were opened, and change or stop them.",
          icon: Link2,
        }]
      : []),
  ];
  const activeTab: Tab = tabs.find((t) => t.key === searchParams.tab)?.key ?? tabs[0].key;
  const activeStatus = STATUS_FILTERS.find((f) => f.key === searchParams.status)?.key ?? null;

  // Every clause is limited to this side's documents, except Requests for
  // Everyone: the Global approver decides them on the Everyone side, though
  // the document stays a team document until it's approved.
  const visibility = scope === "team" ? ("restricted" as const) : ("org" as const);
  const onSide = (w: Prisma.DocumentWhereInput): Prisma.DocumentWhereInput => ({ ...w, visibility });
  const everyoneOnly = (w: Prisma.DocumentWhereInput) => (scope === "everyone" ? [w] : []);
  // Shared links: each person has their own link per document, so you see
  // your own links (and only your customers' opens on them). The document's
  // uploader and owner also see everyone's links to it, each on its own row
  // with who shared it; a superadmin sees every link. Team documents are
  // never shared outside the company, so this is on the Everyone side only.
  const linkWhere: Prisma.ShareLinkWhereInput = isSuperadmin
    ? {}
    : { OR: [{ createdById: user.id }, { document: { OR: [{ uploadedById: user.id }, { ownerId: user.id }] } }] };
  const whereFor: Record<Tab, Prisma.DocumentWhereInput> = {
    review: {
      deletedAt: null,
      OR: [
        // A restored archived document ("Back in review", status revoked) is
        // in review too, same as statusesFor("pending_review").
        onSide({
          status: { in: statusesFor("pending_review") },
          reviewRequests: { some: { reviewerId: user.id, status: "pending" } },
        }),
        ...(decidesEveryone
          ? everyoneOnly({ globalRequests: { some: { status: "pending" as const, requestedById: { not: user.id } } } })
          : []),
        // Merge requests into a document I manage (lib/merge.ts).
        onSide({ mergeRequestsIn: { some: { approverId: user.id, status: "pending", source: { deletedAt: null } } } }),
      ],
    },
    uploads: {
      deletedAt: null,
      visibility,
      OR: [{ uploadedById: user.id }, { versions: { some: { uploadedById: user.id } } }],
    },
    // Uploads I approved or rejected, and Requests for Everyone I decided.
    reviewed: {
      deletedAt: null,
      OR: [
        onSide({
          reviewRequests: {
            some: {
              reviewerId: user.id,
              status: { in: ["approved", "rejected"] },
              NOT: { comments: { startsWith: "Auto-closed:" } },
            },
          },
        }),
        ...everyoneOnly({ globalRequests: { some: { decidedById: user.id } } }),
      ],
    },
    all: isSuperadmin
      ? { deletedAt: null, visibility }
      : {
          deletedAt: null,
          OR: [
            onSide({ uploadedById: user.id }),
            onSide({ versions: { some: { uploadedById: user.id } } }),
            onSide({ reviewRequests: { some: { reviewerId: user.id } } }),
            onSide({ globalRequests: { some: { requestedById: user.id } } }),
            ...everyoneOnly({ globalRequests: { some: { decidedById: user.id } } }),
          ],
        },
    downloads: { deletedAt: null, visibility, events: { some: { userId: user.id, type: "download" } } },
    shared: { deletedAt: null, shareLinks: { some: linkWhere } },
  };

  const section = `mywork:${scope}:${activeTab}`;
  const find = (typeof searchParams.find === "string" ? searchParams.find : "").trim().slice(0, 100);

  const [docs, counts, statusCounts, savedFilters, found, myDownloads] = await Promise.all([
    prisma.document.findMany({
      where: activeStatus ? { AND: [whereFor[activeTab], { status: { in: statusesFor(activeStatus) } }] } : whereFor[activeTab],
      include: {
        category: true,
        uploadedBy: true,
        owner: { select: { name: true } },
        duplicateOf: true,
        teamAccess: { select: { team: { select: { name: true } }, folder: { select: { name: true } } } },
        // Every version (newest first) on "Everything I'm in", to say which
        // ones I uploaded; just the latest elsewhere.
        versions: { orderBy: { versionNumber: "desc" }, ...(activeTab === "all" ? {} : { take: 1 }) },
        reviewRequests: {
          select: { reviewerId: true, status: true, comments: true, createdAt: true, resolvedAt: true, reviewer: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        globalRequests: {
          select: { status: true, decidedById: true, decidedAt: true, requestedById: true },
          orderBy: { createdAt: "desc" },
        },
        mergeRequestsIn: {
          where: { approverId: user.id, status: "pending", source: { deletedAt: null } },
          select: { source: { select: { title: true } }, requestedBy: { select: { name: true } } },
        },
        shareLinks: {
          where: linkWhere,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            token: true,
            accessLevel: true,
            expiresAt: true,
            createdAt: true,
            createdById: true,
            createdBy: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    Promise.all(
      tabs.map((t) =>
        // Shared links counts links, not documents.
        t.key === "shared"
          ? prisma.shareLink.count({ where: { AND: [linkWhere, { document: whereFor.shared }] } })
          : prisma.document.count({ where: whereFor[t.key] })
      )
    ),
    prisma.document.groupBy({ by: ["status"], where: whereFor[activeTab], _count: { _all: true } }),
    getSavedFilters(user.id, section),
    find ? findDocuments(user, find) : Promise.resolve(null),
    activeTab === "downloads"
      ? prisma.documentEvent.groupBy({
          by: ["documentId"],
          where: { userId: user.id, type: "download" },
          _count: { _all: true },
          _max: { timestamp: true },
        })
      : Promise.resolve([]),
  ]);
  const downloadsByDoc = new Map(myDownloads.map((d) => [d.documentId, { times: d._count._all, last: d._max.timestamp }]));
  const shareActivity =
    activeTab === "shared" ? await shareActivityFor(docs.flatMap((d) => d.shareLinks.map((l) => l.id))) : new Map<string, ShareActivitySummary>();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { options: filterOptions, kept } = filterDocs(docs, searchParams);

  const rows: DocRow[] = docs
    .filter((doc) => kept.has(doc.id))
    .map((doc) => {
      const latestVersion = doc.versions[0];
      let statusDetail: string | undefined;
      let statusLabel: string | undefined;
      const involvement = activeTab === "all" ? describeInvolvement(user.id, doc) : undefined;
      const decidedEveryone = doc.globalRequests.find((g) => g.decidedById === user.id);
      if (activeTab === "reviewed" && decidedEveryone && !doc.reviewRequests.some((r) => r.reviewerId === user.id && r.status !== "pending")) {
        const when = (decidedEveryone.decidedAt ?? doc.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        statusDetail = `You ${decidedEveryone.status === "approved" ? "made it public" : "kept it with the team"} on ${when}.`;
      } else if (activeTab === "reviewed") {
        const mine = doc.reviewRequests.find(
          (r) => r.reviewerId === user.id && r.status !== "pending" && !r.comments?.startsWith("Auto-closed:")
        );
        if (mine) {
          const when = (mine.resolvedAt ?? mine.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          statusDetail = `You ${mine.status} this on ${when}.`;
        }
      } else if (activeTab === "review" && doc.mergeRequestsIn.length > 0) {
        statusLabel = "Merge request";
        statusDetail = doc.mergeRequestsIn
          .map((m) => `${m.requestedBy.name} asks to merge "${m.source.title}" into this.`)
          .join(" ");
      } else if (activeTab === "review" && !statusesFor("pending_review").includes(doc.status)) {
        statusLabel = "Request for Everyone";
        statusDetail = "Open it to the whole organization, or send it back.";
      } else if (statusesFor("pending_review").includes(doc.status)) {
        const waiting = [...new Set(doc.reviewRequests.filter((r) => r.status === "pending").map((r) => r.reviewer.name))];
        if (waiting.length) statusDetail = `Waiting on ${waiting.join(", ")}.`;
      }
      return {
        id: doc.id,
        title: doc.title,
        // Team documents have no real category: show their team instead.
        categoryName: doc.category.isSystem
          ? `${doc.teamAccess.map((t) => t.team.name).sort().join(", ") || "Team"} team`
          : doc.category.name,
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
        statusLabel,
        // Everything I'm in: rows are grouped by how you're involved
        // (involvementGroups); where it stands for you shows on the status.
        involvementRoles: involvement?.roles,
        ...(involvement?.status ? { statusDetail: involvement.status.label } : {}),
        visibility: doc.visibility,
        reviewBypassed: doc.reviewBypassed,
        downloadable: doc.downloadable,
        accessTeamNames: doc.teamAccess.map((t) => t.team.name).sort(),
      };
    });

  const countByStatus = new Map(statusCounts.map((c) => [c.status, c._count._all]));
  const tabTotal = counts[tabs.findIndex((t) => t.key === activeTab)];

  // Switching sides (toScope) opens that side's first tab, since each side
  // has its own tabs.
  const tabHref = (tab: Tab | null, status: DocStatus | null = null, toScope: Scope = scope) => {
    const params = new URLSearchParams();
    if (toScope !== defaultScope) params.set("scope", toScope);
    if (tab && tab !== tabs[0].key) params.set("tab", tab);
    if (status) params.set("status", status);
    if (searchParams.view === "grid") params.set("view", "grid");
    const qs = params.toString();
    return qs ? `/dashboard/my-work?${qs}` : "/dashboard/my-work";
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
          <h1 className="mb-1 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
            My Work
            <InfoTooltip
              text={`${tabs.find((t) => t.key === activeTab)?.hint ?? ""} Use Find a document to jump to any document you can see and manage it.`.trim()}
            />
          </h1>
          <div className="mb-4" />

          {/* Quick finder: plain GET form, keeps the current tab and view. */}
          <form action="/dashboard/my-work" method="get" className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
            <label htmlFor="my-work-find" className="mb-2 block text-sm font-medium text-ff-text">
              Find a document
            </label>
            {scope !== defaultScope && <input type="hidden" name="scope" value={scope} />}
            {activeTab !== tabs[0].key && <input type="hidden" name="tab" value={activeTab} />}
            {searchParams.view === "grid" && <input type="hidden" name="view" value="grid" />}
            {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ff-textMuted" aria-hidden />
                <input
                  id="my-work-find"
                  type="search"
                  name="find"
                  defaultValue={find}
                  placeholder="Search any document by title or tag..."
                  className="w-full rounded-ff border border-ff-border py-2 pl-9 pr-3 text-sm focus:border-ff-accent focus:outline-none focus:ring-1 focus:ring-ff-accent"
                />
              </div>
              <button
                type="submit"
                className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
              >
                Search
              </button>
              {find && (
                <Link
                  href={tabHref(activeTab, activeStatus)}
                  className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-textMuted hover:text-ff-text"
                >
                  Clear
                </Link>
              )}
            </div>

            {found && (
              <div className="mt-4">
                {found.length === 0 ? (
                  <p className="text-sm text-ff-textMuted">No documents match &quot;{find}&quot;.</p>
                ) : (
                  <ul className="divide-y divide-ff-border rounded-ff border border-ff-border">
                    {found.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/dashboard/documents/${d.id}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-ff-lavender/40"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium text-ff-text">{d.title}</span>
                          <AccessBadges visibility={d.visibility} reviewBypassed={d.reviewBypassed} downloadable={d.downloadable} teamNames={d.teamAccess.map((t) => t.team.name).sort()} />
                          <span className="text-xs text-ff-textMuted">{d.category.name}</span>
                          <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-xs text-ff-text">{STATUS_LABEL[d.status] ?? d.status}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {found.length === FIND_LIMIT && (
                  <p className="mt-2 text-xs text-ff-textMuted">Showing the first {FIND_LIMIT} matches. Add more words to narrow it down.</p>
                )}
              </div>
            )}
          </form>

          {/* Everyone / Team: every tab below counts and lists only that side,
              and which tabs it has comes from your role on that side. Team
              only shows for people with a team side (hasTeamSide). */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-ff border border-ff-border bg-white p-1 shadow-ff">
            {[
              { key: "everyone" as const, label: "Everyone", icon: Globe },
              ...(hasTeamSide ? [{ key: "team" as const, label: "Team", icon: Users }] : []),
            ].map((s) => {
              const active = s.key === scope;
              const Icon = s.icon;
              return (
                <Link
                  key={s.key}
                  href={tabHref(null, null, s.key)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-ff px-4 py-1.5 text-sm transition-colors ${
                    active ? "bg-ff-accent-gradient font-medium text-white" : "text-ff-textMuted hover:text-ff-text"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {s.label}
                </Link>
              );
            })}
          </div>
          <span className="text-sm text-ff-textMuted">
            Your role here: <span className="font-medium text-ff-text">{scopeRole}</span>
          </span>
          </div>

          <div className={`mb-4 grid grid-cols-1 gap-4 ${tabs.length >= 6 ? "sm:grid-cols-3 lg:grid-cols-6" : tabs.length >= 5 ? "sm:grid-cols-2 lg:grid-cols-5" : tabs.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : tabs.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {tabs.map((t, i) => {
              const isActive = t.key === activeTab;
              const Icon = t.icon;
              return (
                <Link
                  key={t.key}
                  href={tabHref(t.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative flex items-center gap-4 rounded-ff border bg-white p-5 shadow-ff transition-all hover:-translate-y-0.5 hover:shadow-ff-md ${
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
                    <p className="text-2xl font-semibold text-ff-text">{counts[i]}</p>
                    <p className="text-sm text-ff-textMuted">{t.label}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Status chips for this section only: none on "Waiting on me" (all
              of it waits on you), and elsewhere only statuses it actually has. */}
          {activeTab !== "review" && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ff-textMuted">Status:</span>
            {[{ key: null as DocStatus | null, label: "All", count: tabTotal }, ...STATUS_FILTERS.map((f) => ({ ...f, count: statusesFor(f.key).reduce((n, k) => n + (countByStatus.get(k) ?? 0), 0) }))]
              .filter((f) => f.key === null || f.count > 0 || f.key === activeStatus)
              .map(
              (f) => {
                const active = activeStatus === f.key;
                return (
                  <Link
                    key={f.key ?? "all"}
                    href={tabHref(activeTab, f.key)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-ff-accent bg-ff-accent/10 font-medium text-ff-accent"
                        : "border-ff-border bg-white text-ff-textMuted hover:border-ff-accent/40 hover:text-ff-text"
                    }`}
                  >
                    {f.label}
                    <span className="rounded-full bg-ff-lavender px-1.5 text-xs">{f.count}</span>
                  </Link>
                );
              }
            )}
          </div>
          )}

          <FilterBar canUpload={canUploadSomething(user)} showViewToggle basePath="/dashboard/my-work">
            <DocumentFilters
              key={section}
              basePath="/dashboard/my-work"
              section={section}
              options={filterOptions}
              saved={savedFilters}
              keepKeys={["scope", "tab", "status", "view"]}
            />
          </FilterBar>

          {activeTab === "shared" ? (
            <SharedLinksTable
              rows={docs
                .filter((d) => kept.has(d.id))
                .flatMap((d) => d.shareLinks.map((link) => ({ d, link })))
                .map(({ d, link }) => {
                  const activity = shareActivity.get(link.id);
                  const expired = link.expiresAt !== null && link.expiresAt.getTime() < Date.now();
                  return {
                    linkId: link.id,
                    documentId: d.id,
                    title: d.title,
                    mine: link.createdById === user.id,
                    url: `${appUrl}/share/${link.token}`,
                    accessLevel: link.accessLevel === "view_download" && downloadsAllowed(d) ? ("view_download" as const) : ("view" as const),
                    expiresAt: link.expiresAt?.toISOString() ?? null,
                    createdAt: link.createdAt.toISOString(),
                    sharedBy: link.createdById === user.id ? "You" : link.createdBy.name,
                    // Why a link stopped working, same checks as lib/access.ts
                    // shareLinkUsable.
                    state: expired
                      ? "Expired"
                      : !d.shareEnabled
                        ? "Sharing turned off"
                        : d.visibility === "restricted"
                          ? "Now a team document"
                          : d.status !== "published"
                            ? `Paused: ${STATUS_LABEL[d.status]?.toLowerCase() ?? d.status}`
                            : "Active",
                    opens: activity?.opens ?? 0,
                    downloads: activity?.downloads ?? 0,
                    firstOpenedAt: activity?.firstOpenedAt?.toISOString() ?? null,
                    lastOpenedAt: activity?.lastOpenedAt?.toISOString() ?? null,
                    colleagues: activity?.colleagues ?? [],
                  };
                })
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
            />
          ) : activeTab === "downloads" ? (
            <DownloadsTable
              rows={docs
                .filter((d) => kept.has(d.id))
                .map((d) => ({
                  id: d.id,
                  title: d.title,
                  // Team documents: each team's spot in My teams, with its folder.
                  path:
                    d.visibility === "restricted"
                      ? d.teamAccess
                          .map((t) => ["Team", t.team.name, ...(t.folder ? [t.folder.name] : [])].join(" › "))
                          .sort()
                      : [`Everyone › ${d.category.name}`],
                  times: downloadsByDoc.get(d.id)?.times ?? 0,
                  last: downloadsByDoc.get(d.id)?.last ?? null,
                }))
                .sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0))}
            />
          ) : activeTab === "all" ? (
            <DocumentSections groups={involvementGroups(rows)} view={searchParams.view === "grid" ? "grid" : "list"} hasFilters={false} />
          ) : searchParams.view === "grid" ? (
            <DocumentGrid rows={rows} />
          ) : (
            <DocumentTable rows={rows} />
          )}
        </div>
        <Footer />
      </main>
    </div>
  );
}

const FIND_LIMIT = 20;

// Any document the viewer can see: the team rule (documentAccessWhere), and
// beyond that either live (published, or in re-review with its approved
// version still live) or one they're involved in. Superadmins see everything
// that isn't deleted, same as their Review Dashboard.
async function findDocuments(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, find: string) {
  const words = find.split(/\s+/).filter(Boolean).slice(0, 6);
  const reach: Prisma.DocumentWhereInput =
    user.role === "superadmin"
      ? {}
      : {
          OR: [
            { status: "published" },
            { status: "pending_review", currentVersionId: { not: null } },
            { uploadedById: user.id },
            { ownerId: user.id },
            { versions: { some: { uploadedById: user.id } } },
            { reviewRequests: { some: { reviewerId: user.id } } },
          ],
        };
  return prisma.document.findMany({
    where: {
      AND: [
        { deletedAt: null },
        documentAccessWhere(user),
        reach,
        ...words.map((w) => ({
          OR: [{ title: { contains: w, mode: "insensitive" as const } }, { tags: { has: w.toLowerCase() } }],
        })),
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      visibility: true,
      reviewBypassed: true,
      downloadable: true,
      category: { select: { name: true } },
      teamAccess: { select: { team: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: FIND_LIMIT,
  });
}

const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Role chips for a row on "Everything I'm in": what I am on this document
// (Uploader, New version uploader, Reviewer), plus ONE status for where my
// part stands now: waiting on my decision, or my latest decision. Older
// rounds are left to the document's Review tab, so the row stays readable.
// Undefined for a superadmin's row they had no part in.
function describeInvolvement(
  userId: string,
  doc: {
    status: string;
    uploadedById: string;
    versions: { versionNumber: number; uploadedById: string }[];
    reviewRequests: {
      reviewerId: string;
      status: string;
      comments: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
      reviewer: { name: string };
    }[];
    globalRequests: { status: string; decidedById: string | null; decidedAt: Date | null; requestedById: string }[];
  }
): Involvement | undefined {
  const roles: string[] = [];
  if (doc.uploadedById === userId) roles.push("Uploader");
  else if (doc.versions.some((v) => v.uploadedById === userId)) roles.push("New version uploader");

  // "No review needed" is stored as an approval by the uploading manager:
  // that's publishing, not reviewing.
  const isBypass = (r: { status: string; comments: string | null }) =>
    r.status === "approved" && (r.comments?.startsWith("Review bypassed:") ?? false);
  if (doc.reviewRequests.some((r) => r.reviewerId === userId && isBypass(r))) roles.push("Published without review");

  // Request for Everyone: raised it, or decided it as the Global approver.
  const asked = doc.globalRequests.find((g) => g.requestedById === userId);
  const decided = doc.globalRequests.find((g) => g.decidedById === userId);
  if (asked) roles.push("Asked for Everyone");
  if (decided) roles.push("Global approver");

  const mine = doc.reviewRequests.filter((r) => r.reviewerId === userId && !isBypass(r));
  let status: Involvement["status"];
  if (mine.length) {
    roles.push("Reviewer");
    // Only a document actually in review can be waiting on me, the same rule
    // as the "Waiting on me" tab. Older data can hold a leftover "pending"
    // row on a document that has since been decided (e.g. a duplicate
    // assignment in the same round), which must not read as a task.
    const inReview = statusesFor("pending_review").includes(doc.status as DocStatus);
    const pending = inReview && mine.some((r) => r.status === "pending");
    // In review but not on me: say who it's waiting on, so it isn't
    // mistaken for my task (the "In review" filter counts these too).
    const waitingOnOthers =
      inReview
        ? [...new Set(doc.reviewRequests.filter((r) => r.status === "pending" && r.reviewerId !== userId).map((r) => r.reviewer.name))].join(", ")
        : "";
    const decided = mine.filter((r) => r.status !== "pending");
    const latest = [...decided].sort(
      (a, b) => (b.resolvedAt ?? b.createdAt).getTime() - (a.resolvedAt ?? a.createdAt).getTime()
    )[0];
    if (pending) status = { label: "Waiting on your review", tone: "warning" };
    else if (waitingOnOthers) status = { label: `In review, waiting on ${waitingOnOthers}`, tone: "neutral" };
    else if (!latest) status = undefined;
    else if (latest.comments?.startsWith("Auto-closed:")) status = { label: "Closed by another reviewer", tone: "neutral" };
    else
      status = {
        label: `You ${latest.status} it, ${shortDate(latest.resolvedAt ?? latest.createdAt)}`,
        tone: latest.status === "approved" ? "success" : "danger",
      };
  }
  if (!status && decided) {
    status = decided.status === "approved"
      ? { label: `You made it public${decided.decidedAt ? ` on ${shortDate(decided.decidedAt)}` : ""}`, tone: "success" }
      : { label: `You kept it with the team${decided.decidedAt ? ` on ${shortDate(decided.decidedAt)}` : ""}`, tone: "danger" };
  }
  if (!status && asked) {
    status =
      asked.status === "pending"
        ? { label: "Waiting for the Global approver to decide", tone: "warning" }
        : asked.status === "approved"
          ? { label: "Approved: it's public in FireFlink now", tone: "success" }
          : { label: "Not approved: it stays with your team", tone: "danger" };
  }
  // An uploader (not a reviewer) of a document in review: same hint.
  if (!status && doc.status === "pending_review") {
    const names = [...new Set(doc.reviewRequests.filter((r) => r.status === "pending").map((r) => r.reviewer.name))];
    if (names.length) status = { label: `In review, waiting on ${names.join(", ")}`, tone: "neutral" };
  }
  return roles.length ? { roles, status } : undefined;
}

// Everything I'm in, split under headings by how you're involved. Each
// document sits under the first heading that applies, so it appears once.
const INVOLVEMENT_GROUPS: { id: string; name: string; roles: string[] }[] = [
  { id: "uploaded", name: "Uploaded by you", roles: ["Uploader", "New version uploader"] },
  { id: "reviewed", name: "Reviewed by you", roles: ["Reviewer"] },
  { id: "published", name: "Published by you without review", roles: ["Published without review"] },
  { id: "everyone", name: "You made this public", roles: ["Global approver"] },
  { id: "asked", name: "You asked to make it public", roles: ["Asked for Everyone"] },
];

function involvementGroups(rows: (DocRow & { involvementRoles?: string[] })[]) {
  const placed = new Set<string>();
  const groups = INVOLVEMENT_GROUPS.map((g) => {
    const inGroup = rows.filter((r) => !placed.has(r.id) && r.involvementRoles?.some((role) => g.roles.includes(role)));
    inGroup.forEach((r) => placed.add(r.id));
    return { id: g.id, name: g.name, rows: inGroup };
  });
  const rest = rows.filter((r) => !placed.has(r.id));
  return [...groups, { id: "other", name: "Other documents", rows: rest }];
}

// My downloads: what I downloaded, where it sits in the vault, and where the
// file went on my computer. The browser picks that folder, so the app can't
// know the exact path; it's the browser's download folder unless changed.
const SAVED_TO_HINT =
  'Your browser saves downloads to its download folder. On Windows that is usually C:\\Users\\<your name>\\Downloads, on a Mac /Users/<your name>/Downloads. If you changed it in your browser settings, or picked a folder while saving, the file is there instead. It is named after the document and its version, like "Title (v1.1).pdf".';

function DownloadsTable({ rows }: { rows: { id: string; title: string; path: string[]; times: number; last: Date | null }[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
        You haven&apos;t downloaded anything yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-ff border border-ff-border bg-white shadow-ff">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-ff-border bg-[#F4E9F2] text-xs font-semibold uppercase tracking-wide text-[#5B1F51]">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Find it in the vault</th>
            <th className="px-4 py-3 font-medium">
              <span className="inline-flex items-center gap-1">
                Saved to <InfoTooltip text={SAVED_TO_HINT} />
              </span>
            </th>
            <th className="px-4 py-3 font-medium">Times</th>
            <th className="px-4 py-3 font-medium">Last downloaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ff-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-ff-lavender/40">
              <td className="px-4 py-3">
                <Link href={`/dashboard/documents/${r.id}`} className="font-medium text-ff-text hover:text-ff-accent">
                  {r.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-ff-textMuted">
                {r.path.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </td>
              <td className="px-4 py-3 text-ff-textMuted">Downloads folder</td>
              <td className="px-4 py-3 text-ff-textMuted">{r.times}</td>
              <td className="px-4 py-3 text-ff-textMuted">{r.last ? shortDate(r.last) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
