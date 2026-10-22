import Link from "next/link";
import { Lock, Folder, Users, Eye } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { seesAllRestricted, visibleTeamIds, uploadableTeamIds, canManageFolders, managesTeam, contributesToTeam, type AccessUser } from "@/lib/access";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import FilterBar from "@/components/FilterBar";
import DocumentFilters from "@/components/DocumentFilters";
import { filterDocs, type RawParams } from "@/lib/docFilters";
import { getSavedFilters } from "@/lib/savedFilters";
import TeamSearchBox from "./TeamSearchBox";
import NewInTeam from "./NewInTeam";
import { NewDocumentsProvider } from "@/components/NewDocumentsProvider";
import { newDocumentsFor } from "@/lib/newDocuments";
import TeamFolderActions from "./TeamFolderActions";
import InfoTooltip from "@/components/InfoTooltip";
import { TEAM_ROLE_LABEL } from "@/lib/roleCopy";

// Home's "My teams" view (/dashboard?space=teams; it replaced the separate
// Team Space page): the restricted documents shared with the viewer's own
// teams (lib/access.ts). One chip per team, always one team open (the
// viewer's own first team by default; there's no "All my teams"). Inside one
// team: its folders (TeamFolder, created by the team's managers), a search
// box over the team's documents (title, tags, category, uploader and the
// file's text), and the usual filters. Superadmins and people who see all
// teams get every team's chip.
//
// Listed: live documents only, i.e. published, or back in re-review while
// their last approved version stays live (status pending_review with a
// current version), same as what the Everyone view shows.
export default async function TeamSpaceView({
  user,
  searchParams,
}: {
  user: AccessUser;
  searchParams: RawParams & { team?: string; view?: string; folder?: string; q?: string };
}) {
  const teams = await prisma.team.findMany({
    where: seesAllRestricted(user) ? {} : { id: { in: visibleTeamIds(user) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const teamIds = teams.map((t) => t.id);
  // With no team picked, open the person's working team: one they contribute
  // to or manage, before a team they're only a Member of (so someone in Sales
  // as Contributor and BD as Member lands on Sales, not BD alphabetically).
  const worksIn = (t: { id: string }) => user.teamRoles[t.id] === "contributor" || user.teamRoles[t.id] === "manager";
  // Default team: the first team they were added to (where they work, not
  // a view-only one), so it doesn't change when they join another team.
  const joinedOrder = (
    await prisma.userTeam.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { teamId: true } })
  ).map((m) => m.teamId);
  const byJoined = [...teams].sort((a, b) => {
    const ia = joinedOrder.indexOf(a.id);
    const ib = joinedOrder.indexOf(b.id);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  const defaultTeam = byJoined.find(worksIn) ?? byJoined.find((t) => user.teamIds.includes(t.id)) ?? teams[0] ?? null;
  const activeTeam = teams.find((t) => t.id === searchParams.team) ?? defaultTeam;
  const scopeTeamIds = activeTeam ? [activeTeam.id] : teamIds;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim();

  const liveWhere = {
    deletedAt: null,
    visibility: "restricted" as const,
    OR: [{ status: "published" as const }, { status: "pending_review" as const, currentVersionId: { not: null } }],
  };

  // Folders only exist inside one team. "none" lists documents not in any
  // folder; anything else must be one of this team's folders.
  const folders = activeTeam
    ? await prisma.teamFolder.findMany({ where: { teamId: activeTeam.id }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const activeFolder = folders.find((f) => f.id === searchParams.folder) ?? null;
  const unfiledOnly = Boolean(activeTeam) && searchParams.folder === "none";
  const folderWhere = activeTeam
    ? { teamAccess: { some: { teamId: activeTeam.id, ...(activeFolder ? { folderId: activeFolder.id } : unfiledOnly ? { folderId: null } : {}) } } }
    : { teamAccess: { some: { teamId: { in: scopeTeamIds } } } };

  const section = `team:${activeTeam?.id ?? "all"}`;
  const [docs, countsByTeam, folderCounts, savedFilters] = await Promise.all([
    scopeTeamIds.length
      ? prisma.document.findMany({
          where: { ...liveWhere, ...folderWhere },
          include: {
            category: true,
            uploadedBy: true,
            owner: { select: { name: true } },
            currentVersion: { select: { previewPdfPath: true, extractedText: true } },
            duplicateOf: true,
            teamAccess: { select: { teamId: true, folder: { select: { name: true } }, team: { select: { name: true } } } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    teamIds.length
      ? prisma.documentTeamAccess.groupBy({
          by: ["teamId"],
          where: { teamId: { in: teamIds }, document: liveWhere },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    activeTeam
      ? prisma.documentTeamAccess.groupBy({
          by: ["folderId"],
          where: { teamId: activeTeam.id, document: liveWhere },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    getSavedFilters(user.id, section),
  ]);

  // The search box matches the file's text too, so it runs here rather than
  // in filterDocs (whose keyword only looks at title/tags/uploader).
  const { q: _q, ...otherParams } = searchParams;
  const { options: filterOptions, kept } = filterDocs(docs, otherParams);
  const needle = q.toLowerCase();
  const matches = (doc: (typeof docs)[number]) =>
    !needle ||
    [doc.title, doc.tags.join(" "), doc.category.name, doc.uploadedBy.name, doc.currentVersion?.extractedText ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);

  const countOf = new Map(countsByTeam.map((c) => [c.teamId, c._count._all]));
  const folderCountOf = new Map(folderCounts.map((c) => [c.folderId ?? "none", c._count._all]));
  const teamTotal = activeTeam ? countOf.get(activeTeam.id) ?? 0 : 0;

  const rows: DocRow[] = docs
    .filter((doc) => kept.has(doc.id) && matches(doc))
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      // Team documents have no category; the column shows their folder here.
      categoryName: doc.teamAccess.find((x) => x.teamId === activeTeam?.id)?.folder?.name ?? "No folder",
      docType: doc.docType,
      status: doc.status,
      uploadedByName: doc.uploadedBy.name,
      updatedAt: doc.updatedAt.toISOString(),
      isStale: false,
      duplicateOfTitle: doc.duplicateOf?.title ?? null,
      hasCurrentVersion: doc.currentVersion !== null,
      hasPreviewPdf: Boolean(doc.currentVersion?.previewPdfPath),
      externalUrl: doc.externalUrl,
      // Every row is the open team's, so a "<Team> only" label would just repeat.
      visibility: undefined,
      reviewBypassed: doc.reviewBypassed,
      downloadable: doc.downloadable,
      accessTeamNames: doc.teamAccess.map((t) => t.team.name).sort(),
    }));

  const href = (teamId: string | null, folder: string | null = null) => {
    const params = new URLSearchParams({ space: "teams" });
    if (teamId) params.set("team", teamId);
    if (teamId && folder) params.set("folder", folder);
    if (q) params.set("q", q);
    if (searchParams.view === "grid") params.set("view", "grid");
    return `/dashboard?${params.toString()}`;
  };
  // The viewer's own teams first (default first), then teams seen only
  // through the leadership view. Each chip says the viewer's role there.
  const tabs = teams
    .map((t) => ({
      id: t.id as string | null,
      name: t.name,
      count: countOf.get(t.id) ?? 0,
      role: user.teamRoles[t.id] ? TEAM_ROLE_LABEL[user.teamRoles[t.id]] : "View only",
      isDefault: t.id === defaultTeam?.id,
      mine: user.teamIds.includes(t.id),
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.mine) - Number(a.mine));
  const myTeamTabs = tabs.filter((t) => t.mine);
  const canFolders = activeTeam ? canManageFolders(user, activeTeam.id) : false;
  // Upload only inside a team this viewer may upload to; it goes straight
  // to that team (and the open folder).
  const uploadable = uploadableTeamIds(user);
  const canUploadHere = Boolean(activeTeam) && (uploadable === null || uploadable.includes(activeTeam!.id));
  const uploadHref = activeTeam
    ? `/dashboard/upload?team=${activeTeam.id}${activeFolder ? `&folder=${activeFolder.id}` : ""}`
    : undefined;
  const uploadLabel = activeTeam ? `Upload to ${activeFolder ? activeFolder.name : activeTeam.name}` : undefined;

  // One line saying what this viewer may do here, so nobody has to guess.
  const yourPart = activeTeam
    ? managesTeam(user, activeTeam.id)
      ? `In ${activeTeam.name} you're a Manager: you approve its uploads, can publish without review, and organise its folders.`
      : contributesToTeam(user, activeTeam.id)
        ? `In ${activeTeam.name} you're a Contributor: you can upload for this team and move its documents into folders. A team Manager approves uploads.`
        : user.teamIds.includes(activeTeam.id)
          ? `In ${activeTeam.name} you're a Member: you can view and download this team's documents.`
          : `You're not in ${activeTeam.name}. You see its documents through your leadership view: view, download and comment only.`
    : null;
  // Why this team opens first.
  const defaultNote =
    defaultTeam && user.teamIds.includes(defaultTeam.id)
      ? `${defaultTeam.name} is your default team (the first team you were added to), so My teams opens it first.`
      : null;
  // Both sit behind the (i) on the open team's line, not on the page.
  const teamInfo = [yourPart, defaultNote && myTeamTabs.length > 1 ? defaultNote : null].filter(Boolean).join(" ");

  if (teams.length === 0) {
    return (
      <div className="rounded-ff border border-ff-border bg-white p-8 text-center shadow-ff">
        <Lock className="mx-auto mb-2 h-6 w-6 text-ff-textMuted" aria-hidden />
        <p className="text-sm font-medium text-ff-text">You aren&apos;t in a team yet</p>
        <p className="mt-1 text-sm text-ff-textMuted">
          Ask a superadmin to add you to your team in People. Your team&apos;s documents will show up here.
        </p>
      </div>
    );
  }

  // "New" notices for the open team only (lib/newDocuments.ts).
  const newDocs = activeTeam ? await newDocumentsFor(user, { kind: "team", teamId: activeTeam.id }) : null;

  const tab = (active: boolean) =>
    `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
      active ? "border-ff-accent font-medium text-ff-accent" : "border-transparent text-ff-textMuted hover:text-ff-text"
    }`;

  // Segment inside the team switcher's pill track.
  const chip = (active: boolean) =>
    `flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm transition-all ${
      active ? "bg-ff-plum-gradient font-semibold text-white shadow-ff-md" : "text-ff-text hover:bg-ff-lavender/60"
    }`;
  const avatar = (name: string, size: "sm" | "md", active = true) => (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
        size === "md" ? "h-8 w-8 text-sm" : "h-6 w-6 text-xs"
      } ${active ? "bg-ff-plum-gradient text-white ring-2 ring-white/30" : "bg-ff-lavenderDeep text-ff-accent"}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
  const activeTab = tabs.find((t) => t.id === activeTeam?.id);

  return (
    <NewDocumentsProvider
      initialDocumentIds={newDocs?.documentIds ?? []}
      initialRecentDocs={newDocs?.recentDocs ?? []}
      scopeQuery={activeTeam ? `scope=team&team=${activeTeam.id}` : "scope=everyone"}
    >
      {/* Team line, one slim row. One team (most people): a badge with the
          team's initial, its name and your role. Several: a pill track to
          switch (your own teams first, then teams seen through the
          leadership view), then your role in the open one. What that role
          lets you do is behind the (i). */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {tabs.length > 1 ? (
          [
            { label: "Your teams", icon: Users, rows: myTeamTabs },
            { label: "Leadership view", icon: Eye, rows: tabs.filter((t) => !t.mine) },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group, i) => (
              <div key={group.label} className="flex flex-wrap items-center gap-2">
                {i > 0 && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ff-textMuted">
                    <group.icon className="h-3.5 w-3.5" aria-hidden />
                    {group.label}
                  </span>
                )}
                <nav
                  aria-label={group.label}
                  className="flex flex-wrap items-center gap-1 rounded-full border border-ff-border bg-ff-surface-gradient p-1 shadow-ff"
                >
                  {group.rows.map((t) => {
                    const active = (activeTeam?.id ?? null) === t.id;
                    return (
                      <Link key={t.id ?? "all"} href={href(t.id)} aria-current={active ? "page" : undefined} className={chip(active)}>
                        {avatar(t.name, "sm", active)}
                        {t.name}
                        <span className={`text-xs font-medium ${active ? "text-white/75" : "text-ff-textMuted"}`} title="Documents">
                          {t.count}
                        </span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            ))
        ) : (
          activeTeam && (
            <div className="flex items-center gap-2.5 rounded-full border border-ff-border bg-ff-surface-gradient py-1 pl-1 pr-4 shadow-ff">
              {avatar(activeTeam.name, "md")}
              <span className="text-sm font-semibold text-ff-text">{activeTeam.name}</span>
            </div>
          )
        )}
        {activeTeam && activeTab && (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-ff-accent/20 bg-ff-lavender px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ff-accent">
              {activeTab.mine ? activeTab.role : "Leadership view"}
            </span>
            {activeTab.isDefault && activeTab.mine && myTeamTabs.length > 1 && (
              <span className="rounded-full border border-ff-success/20 bg-ff-success/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ff-success">
                Default
              </span>
            )}
            {teamInfo && <InfoTooltip text={teamInfo} />}
          </div>
        )}
      </div>

      {activeTeam && <NewInTeam teamName={activeTeam.name} />}

      {/* Folders as a plain row of tabs (no box). */}
      {activeTeam && (folders.length > 0 || canFolders) && (
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-ff-border">
          {folders.length > 0 && (
            <>
              <Link href={href(activeTeam.id)} className={tab(!activeFolder && !unfiledOnly)}>
                All <span className="text-xs text-ff-textMuted">{teamTotal}</span>
              </Link>
              {folders.map((f) => (
                <Link key={f.id} href={href(activeTeam.id, f.id)} className={tab(activeFolder?.id === f.id)}>
                  <Folder className="h-3.5 w-3.5" aria-hidden />
                  {f.name} <span className="text-xs text-ff-textMuted">{folderCountOf.get(f.id) ?? 0}</span>
                </Link>
              ))}
              <Link href={href(activeTeam.id, "none")} className={tab(unfiledOnly)}>
                Not in a folder <span className="text-xs text-ff-textMuted">{folderCountOf.get("none") ?? 0}</span>
              </Link>
            </>
          )}
          {canFolders && (
            <div className="ml-auto pb-1">
              <TeamFolderActions teamId={activeTeam.id} activeFolder={activeFolder} />
            </div>
          )}
        </div>
      )}

      {/* One toolbar: search, filters, view, upload. */}
      <FilterBar canUpload={canUploadHere} uploadHref={uploadHref} uploadLabel={uploadLabel} showViewToggle basePath="/dashboard">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
          <TeamSearchBox
            initialQuery={q}
            placeholder={activeTeam ? `Search ${activeTeam.name}, including text inside files` : "Search your teams' documents"}
          />
          <DocumentFilters
            key={section}
            basePath="/dashboard"
            section={section}
            options={filterOptions}
            saved={savedFilters}
            keepKeys={["space", "team", "folder", "q", "view"]}
            compact
          />
        </div>
      </FilterBar>
      {q && (
        <p className="mb-2 text-sm text-ff-textMuted">
          {rows.length} document{rows.length === 1 ? "" : "s"} match &quot;{q}&quot;
          {activeFolder ? ` in ${activeFolder.name}` : activeTeam ? ` in ${activeTeam.name}` : ""}.
        </p>
      )}
      {searchParams.view === "grid" ? <DocumentGrid rows={rows} /> : <DocumentTable rows={rows} categoryLabel="Folder" />}
    </NewDocumentsProvider>
  );
}
