// Team-based document access: the single place the "who may see a
// restricted document" rule lives. Every listing, search, detail page,
// preview/download route, notification and admin report goes through one of
// the helpers below, so the rule can't drift between call sites.
//
// The rule, layered ON TOP of the existing publish-state rule (a pending/
// rejected/revoked document is still only visible to its stakeholders):
//   - visibility "org": everyone, same as before team access existed.
//   - visibility "restricted": members of any team in Document.teamAccess,
//     plus superadmins, people with "Sees all teams" (User.seesAllTeams),
//     and the document's own stakeholders (uploader, owner, any reviewer
//     ever assigned), who need it to do their part of the workflow.
//
// Callers that can't see a document get a 404, never a 403, so an outsider
// can't confirm a confidential document exists.
//
// What someone may DO with a team's restricted documents comes from their
// role inside that team (UserTeam.role), not their org role (User.role, which
// governs documents visible to everyone):
//   member       sees the team's documents
//   contributor  also uploads documents restricted to the team
//   manager      also reviews/approves them, extends them to other teams,
//                and raises a "Request for Everyone"
// "Sees all teams" lets someone view (and comment on) every team's documents
// but gives no team rights from that alone. Taking a team document org-wide
// is never done from inside a team: a team manager raises a "Request for
// Everyone" (GlobalPublishRequest) and the Global approver decides it: one
// org manager picked by a superadmin in Settings (User.isGlobalApprover).

import type { Prisma } from "@prisma/client";
import type { Role } from "./rbac";
import { can } from "./rbac";
import { prisma } from "./prisma";
import { ensureTeamCategory, TEAM_CATEGORY_ID } from "./teamCategory";

export type TeamRoleName = "member" | "contributor" | "manager";

export type AccessUser = {
  id: string;
  role: Role;
  teamIds: string[];
  seesAllTeams: boolean;
  // Leadership view of only these teams (when not seesAllTeams).
  viewTeamIds: string[];
  // The user's role in each of their teams, keyed by team id.
  teamRoles: Record<string, TeamRoleName>;
  // Picked by a superadmin in Settings as the one Global approver.
  isGlobalApprover: boolean;
};

export type DocAccessInfo = {
  visibility: "org" | "restricted";
  // grantedById is loaded where access is changed (the Manage tab), so a
  // person can take back a team they added themselves.
  teamAccess: { teamId: string; grantedById?: string }[];
  // Present when loaded with accessInclude: a pending "Request for Everyone"
  // lets the Global approver in to decide it.
  globalRequests?: { status: string }[];
};

/** Can anyone who sees this document download its file? Only when its
 * approving manager allowed downloads (Document.downloadable), for team
 * documents and documents for everyone alike (team documents were always
 * preview only until 2026-10-12). Enforced by the download routes; the UI
 * hides Download and uses the protected viewer to match. */
export function downloadsAllowed(doc: { visibility: string; downloadable: boolean }): boolean {
  return doc.downloadable;
}

/** Who may turn a document's downloads on or off after publishing (the
 * Manage tab): superadmins, and whoever has manager rights on it (an org
 * manager for an Everyone document, a team manager for a team document). */
export function canChangeDownloads(user: AccessUser, doc: DocAccessInfo & DocStake): boolean {
  if (user.role === "superadmin") return true;
  return documentRole(user, doc) === "manager" && teamAllows(user, doc);
}

/** Is this user a manager inside the given team? */
export function managesTeam(user: AccessUser, teamId: string): boolean {
  return user.teamRoles[teamId] === "manager";
}

/** May this user upload documents restricted to the given team? Team
 * contributors and team managers. */
export function contributesToTeam(user: AccessUser, teamId: string): boolean {
  const r = user.teamRoles[teamId];
  return r === "contributor" || r === "manager";
}

/** Teams this user may restrict an upload to: every team (null) for
 * superadmins and org contributors/managers, who may upload into a team they
 * aren't in (they then see only their own upload there, never the team's
 * other documents); otherwise the teams they contribute to or manage. */
export function uploadableTeamIds(user: AccessUser): string[] | null {
  if (can(user.role, "upload")) return null;
  return user.teamIds.filter((t) => contributesToTeam(user, t));
}

/** May this user upload at all? Their org role allows it, or they are a
 * contributor/manager in at least one team (then only restricted uploads). */
export function canUploadSomething(user: AccessUser): boolean {
  return can(user.role, "upload") || user.teamIds.some((t) => contributesToTeam(user, t));
}

/** Does this user have anything for My Work: an org role above User, or
 * uploads/reviews through a team role? */
export function hasMyWork(user: AccessUser): boolean {
  return user.role !== "user" || canUploadSomething(user) || managesAnyTeam(user);
}

/** Who decides a team's "Request for Everyone": the one Global approver,
 * an org manager picked by a superadmin in Settings. Losing the Manager role
 * stops them deciding, even while still picked. */
export function decidesEveryoneRequests(user: AccessUser): boolean {
  return user.isGlobalApprover && user.role === "manager";
}

/** May this user create, rename and delete folders in a team's documents,
 * and move the team's documents between them? The team's managers and
 * superadmins. */
export function canManageFolders(user: AccessUser, teamId: string): boolean {
  return user.role === "superadmin" || managesTeam(user, teamId);
}

/** May this user browse a team's folders? Its members, superadmins and
 * people who see all teams. */
export function canSeeTeam(user: AccessUser, teamId: string): boolean {
  return seesAllRestricted(user) || user.teamIds.includes(teamId) || user.viewTeamIds.includes(teamId);
}

/** Teams whose documents this user can see without "all": their own teams
 * plus any picked for their leadership view. */
export function visibleTeamIds(user: AccessUser): string[] {
  return [...new Set([...user.teamIds, ...user.viewTeamIds])];
}

/** Is this user a manager in any team? */
export function managesAnyTeam(user: AccessUser): boolean {
  return user.teamIds.some((t) => managesTeam(user, t));
}

/** Is this user a team manager of one of this restricted document's teams? */
export function managesDocumentTeam(user: AccessUser, doc: DocAccessInfo): boolean {
  return doc.visibility === "restricted" && doc.teamAccess.some((a) => managesTeam(user, a.teamId));
}

/** May this user act as a reviewer on this document? Everyone documents:
 * org managers, as before. Team documents: managers of one of its teams,
 * whatever their org role, or the Global approver (any team; they still only
 * see the team documents they're assigned). Superadmins never review. */
export function canReviewDocument(user: AccessUser, doc: DocAccessInfo): boolean {
  // The Global approver may review any team's document they're assigned.
  if (doc.visibility === "restricted") return managesDocumentTeam(user, doc) || decidesEveryoneRequests(user);
  return user.role === "manager";
}

/** May this user publish with "No review needed" (labelled Review
 * Bypassed)? Opt-in, managers only, never contributors. Everyone documents:
 * org managers. Team documents: org managers (into any team), or someone
 * who manages every chosen team. */
export function canBypassReviewFor(user: AccessUser, visibility: "org" | "restricted", teamIds: string[]): boolean {
  if (user.role === "manager") return visibility === "org" || teamIds.length > 0;
  return visibility === "restricted" && teamIds.length > 0 && teamIds.every((t) => managesTeam(user, t));
}

/** The role that governs what this user may do to one document (edit,
 * replace the file, revoke, archive, delete, manage feedback). Everyone
 * documents: their org role, as before. Team documents: their strongest role
 * among the document's teams, so a team manager has manager rights there
 * whatever their org role, while an org manager who is only a member there,
 * or someone who "Sees all teams", has view-only rights. An org contributor
 * or manager who uploaded it into a team they aren't in keeps contributor
 * rights on it (edit it, upload a new version after a rejection).
 *
 * Manager rights on a document also need involvement in it (isInvolvedIn):
 * its uploader, or a manager who reviewed it (approved it, published it
 * without review, or was assigned or added as a reviewer: that is how
 * another manager gets "invited"), or the Global approver who opened it to
 * everyone. Any other manager has view-only rights
 * on someone else's document. Superadmins keep their own role everywhere. */
export function documentRole(user: AccessUser, doc: DocAccessInfo & DocStake): Role {
  if (user.role === "superadmin") return user.role;
  let role: Role;
  if (doc.visibility !== "restricted") {
    role = user.role;
  } else {
    role = doc.uploadedById === user.id && can(user.role, "upload") ? "contributor" : "user";
    for (const a of doc.teamAccess) {
      const r = user.teamRoles[a.teamId];
      if (r === "manager") {
        role = "manager";
        break;
      }
      if (r === "contributor") role = "contributor";
    }
  }
  return role === "manager" && !isInvolvedIn(user, doc) ? "user" : role;
}

/** Who took part in a document: needed for documentRole's manager rule. */
export type DocStake = {
  uploadedById: string;
  ownerId: string;
  reviewRequests: { reviewerId: string }[];
  // The Global approver who opened it to everyone manages it too.
  globalRequests?: { status: string; decidedById: string | null }[];
};

/** Is this user the document's uploader, or a reviewer on any round of it
 * (approver, original reviewer, reassigned or added reviewer)? */
export function isInvolvedIn(user: { id: string }, doc: DocStake): boolean {
  return (
    doc.uploadedById === user.id ||
    doc.ownerId === user.id ||
    doc.reviewRequests.some((r) => r.reviewerId === user.id) ||
    (doc.globalRequests ?? []).some((g) => g.status === "approved" && g.decidedById === user.id)
  );
}

/** Prisma select fragment carrying what DocStake needs. */
export const stakeSelect = {
  uploadedById: true,
  ownerId: true,
  reviewRequests: { select: { reviewerId: true } },
  globalRequests: { select: { status: true, decidedById: true } },
} as const;

/** documentRole() for a document known only by id, for routes that check
 * permissions before loading it. Unknown ids fall back to the org role (the
 * route then 404s on its own). */
export async function documentRoleById(user: AccessUser, documentId: string): Promise<Role> {
  if (user.role === "superadmin") return user.role;
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { visibility: true, teamAccess: { select: { teamId: true } }, ...stakeSelect },
  });
  return doc ? documentRole(user, doc) : user.role;
}

/** May this user raise a "Request for Everyone" on this document? A team
 * manager of one of its teams, while it is restricted. */
export function canRequestEveryone(user: AccessUser, doc: DocAccessInfo): boolean {
  return managesDocumentTeam(user, doc);
}

/** Someone with "Sees all teams" looking at a document of a team they
 * aren't in: they may view and comment on it, nothing more. */
export function isSeesAllOutsider(user: AccessUser, doc: DocAccessInfo): boolean {
  return (
    doc.visibility === "restricted" &&
    (user.seesAllTeams || doc.teamAccess.some((a) => user.viewTeamIds.includes(a.teamId))) &&
    !doc.teamAccess.some((a) => user.teamIds.includes(a.teamId))
  );
}

/** Superadmins and people with "Sees all teams" see every restricted document. */
export function seesAllRestricted(user: AccessUser): boolean {
  return user.role === "superadmin" || user.seesAllTeams;
}

/** The team half of the rule only: does visibility let this user in? Callers
 * combine this with their own publish-state/stakeholder check, e.g.
 * `(isPubliclyVisible && teamAllows(user, doc)) || isStakeholder`. */
export function teamAllows(user: AccessUser, doc: DocAccessInfo): boolean {
  if (doc.visibility !== "restricted") return true;
  if (seesAllRestricted(user)) return true;
  if (decidesEveryoneRequests(user) && doc.globalRequests?.some((r) => r.status === "pending")) return true;
  const visible = visibleTeamIds(user);
  return doc.teamAccess.some((a) => visible.includes(a.teamId));
}

/** Prisma include fragment carrying what teamAllows() needs. */
export const accessInclude = {
  teamAccess: { select: { teamId: true } },
  globalRequests: { where: { status: "pending" }, select: { status: true } },
} as const;

/** Prisma where fragment limiting a Document query to what this user may
 * see under the team rule. Merge it with AND alongside a query's own
 * conditions (it uses OR internally, so spreading it next to another OR
 * would overwrite one of them). */
export function documentAccessWhere(user: AccessUser): Prisma.DocumentWhereInput {
  if (seesAllRestricted(user)) return {};
  const visible = visibleTeamIds(user);
  return {
    OR: [
      { visibility: "org" },
      ...(visible.length ? [{ teamAccess: { some: { teamId: { in: visible } } } }] : []),
      { uploadedById: user.id },
      { ownerId: user.id },
      { reviewRequests: { some: { reviewerId: user.id } } },
      // The Global approver needs to open a team document to decide its
      // pending "Request for Everyone".
      ...(decidesEveryoneRequests(user) ? [{ globalRequests: { some: { status: "pending" as const } } }] : []),
    ],
  };
}

/** The same rule as a Meilisearch filter expression, or null when the user
 * sees everything. `visibility != "restricted"` (rather than `= "org"`) also
 * matches documents indexed before team access existed, which carry no
 * visibility field at all, so nothing disappears from search before the
 * index has been rebuilt. */
export function searchAccessFilter(user: AccessUser): string | null {
  if (seesAllRestricted(user)) return null;
  const q = (v: string) => JSON.stringify(v);
  const clauses = ['visibility != "restricted"', `stakeholderIds = ${q(user.id)}`];
  const visible = visibleTeamIds(user);
  if (visible.length) clauses.push(`accessTeamIds IN [${visible.map(q).join(", ")}]`);
  return `(${clauses.join(" OR ")})`;
}

/** One-query gate for per-document API routes: false when the team rule
 * hides this document from the user (stakeholders always pass), or when it
 * doesn't exist. Routes answer false with a 404. It says nothing about
 * publish state or role permissions; each route still checks those itself. */
export async function passesTeamGate(user: AccessUser, documentId: string): Promise<boolean> {
  if (seesAllRestricted(user)) return true;
  const n = await prisma.document.count({ where: { AND: [{ id: documentId }, documentAccessWhere(user)] } });
  return n > 0;
}

/** Ids of the documents (from the given set) this user may see. For
 * filtering lists that only carry a documentId, like notifications. */
export async function visibleDocumentIds(user: AccessUser, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (seesAllRestricted(user)) return new Set(ids);
  const docs = await prisma.document.findMany({
    where: { AND: [{ id: { in: ids } }, documentAccessWhere(user)] },
    select: { id: true },
  });
  return new Set(docs.map((d) => d.id));
}

/** Whether a document is restricted. Used to keep confidential titles out of
 * the shared Google Chat spaces. Unknown ids count as not restricted. */
export async function isRestrictedDocument(documentId: string): Promise<boolean> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { visibility: true } });
  return doc?.visibility === "restricted";
}

/** Active users who may see this document under the team rule. Used to scope
 * the "announce to all users" broadcast and other fan-out notifications. */
export function usersWhoCanSeeWhere(doc: DocAccessInfo): Prisma.UserWhereInput {
  if (doc.visibility !== "restricted") return {};
  const teamIds = doc.teamAccess.map((a) => a.teamId);
  return {
    OR: [
      { role: "superadmin" },
      { seesAllTeams: true },
      ...(teamIds.length
        ? [{ teamMemberships: { some: { teamId: { in: teamIds } } } }, { viewTeams: { some: { teamId: { in: teamIds } } } }]
        : []),
    ],
  };
}

/** People allowed to review a document (the database form of
 * canReviewDocument): for a restricted document, active team managers of one
 * of its teams, whatever their org role; for an org document, any active org
 * manager, as before. */
export function eligibleReviewerWhere(doc: DocAccessInfo): Prisma.UserWhereInput {
  if (doc.visibility !== "restricted") return { role: "manager", isActive: true };
  const teamIds = doc.teamAccess.map((a) => a.teamId);
  return {
    isActive: true,
    OR: [
      { teamMemberships: { some: { teamId: { in: teamIds }, role: "manager" } } },
      // The Global approver may review any team's document.
      { isGlobalApprover: true, role: "manager" },
    ],
  };
}

/** Can this document have a public share link at all? Only documents for
 * Everyone: team documents stay inside the company, for every user. On an
 * Everyone document, anyone who can see it may create a link while its
 * sharing is turned on (Document.shareEnabled). */
export function sharingAllowed(doc: { visibility: string }): boolean {
  return doc.visibility !== "restricted";
}

/** People working on a document's review: its uploader, its owner, anyone
 * assigned as a reviewer in any round, and superadmins. They may preview and
 * download versions that aren't published yet (the one under review), so a
 * team Manager whose org role is User can still open what they're reviewing.
 * Everyone else only ever gets published versions. */
export function involvedInReview(
  user: { id: string; role: string },
  doc: { uploadedById: string; ownerId: string; versions?: { uploadedById: string }[] },
  reviewRequests: { reviewerId: string }[]
): boolean {
  return (
    user.role === "superadmin" ||
    doc.uploadedById === user.id ||
    doc.ownerId === user.id ||
    Boolean(doc.versions?.some((v) => v.uploadedById === user.id)) ||
    reviewRequests.some((r) => r.reviewerId === user.id)
  );
}

/** Whether a public share link may serve its document right now. Every
 * public share route (app/share/[token], app/api/share/[token]/*) checks
 * this, so archiving a document, sending it back to review, turning sharing
 * off or making it a team document closes the link at once, not just
 * deleting it or the link expiring. */
export function shareLinkUsable(
  share: {
    expiresAt: Date | null;
    document: { deletedAt: Date | null; status: string; shareEnabled: boolean; visibility: string };
  } | null
): boolean {
  if (!share) return false;
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return false;
  const doc = share.document;
  return !doc.deletedAt && doc.status === "published" && doc.shareEnabled && sharingAllowed(doc);
}

/** Can this user change a document's visibility/teams?
 *  - Restricting an Everyone document: the uploader, an org manager, or a
 *    superadmin.
 *  - Changing a team document's teams: the uploader, a team manager of one
 *    of its teams, or a superadmin.
 *  - Opening a team document up to Everyone: only a superadmin directly;
 *    everyone else goes through "Request for Everyone" (the Everyone
 *    approver decides). */
export function canChangeAccess(
  user: AccessUser,
  doc: DocAccessInfo & DocStake,
  target: "org" | "restricted"
): boolean {
  if (user.role === "superadmin") return true;
  if (doc.visibility === "restricted" && target === "org") return false;
  // A manager with rights on this document (documentRole: involved in it),
  // or its uploader.
  return documentRole(user, doc) === "manager" || doc.uploadedById === user.id;
}

export const EVERYONE_VIA_REQUEST =
  "A team document can't be opened to everyone directly. A team manager can use Request for Everyone, which the Global approver decides.";

/** Validates a requested change of who can see a document, shared by the
 * Manage tab (app/api/documents/[id]/access) and the approval step
 * (app/api/documents/[id]/review), so both enforce exactly the same rules.
 * Returns the cleaned team list, or an error with its HTTP status. A request
 * that changes nothing always passes, so a reviewer confirming the uploader's
 * choice is never blocked by rules about changing it.
 *
 * asApprover: the manager approving the document for publication (the
 * review route) is its gatekeeper, so they may restrict it to ANY teams,
 * remove any team, or open it to everyone, whether or not they belong to
 * those teams. Everyone else (the Manage tab) gets the narrower rules. */
export async function checkAccessChange(
  user: AccessUser,
  doc: DocAccessInfo & DocStake,
  visibility: unknown,
  teamIds: unknown,
  { asApprover = false }: { asApprover?: boolean } = {}
): Promise<{ ok: true; visibility: "org" | "restricted"; teamIds: string[]; changed: boolean } | { ok: false; error: string; status: number }> {
  if (visibility !== "org" && visibility !== "restricted") {
    return { ok: false, error: "Choose who can see this document: everyone, or restricted to teams.", status: 400 };
  }
  let requested: string[] = [];
  if (visibility === "restricted") {
    if (!Array.isArray(teamIds) || teamIds.length === 0 || teamIds.some((t) => typeof t !== "string" || !t)) {
      return { ok: false, error: "Pick at least one team for a restricted document.", status: 400 };
    }
    requested = [...new Set(teamIds as string[])];
  }
  const current = doc.visibility === "restricted" ? doc.teamAccess.map((a) => a.teamId) : [];
  const changed =
    visibility !== doc.visibility ||
    requested.length !== current.length ||
    requested.some((t) => !current.includes(t));
  if (!changed) return { ok: true, visibility, teamIds: requested, changed: false };

  if (asApprover) {
    if (doc.visibility === "restricted" && visibility === "org" && user.role !== "superadmin") {
      return { ok: false, error: EVERYONE_VIA_REQUEST, status: 403 };
    }
    if (requested.length) {
      const found = await prisma.team.count({ where: { id: { in: requested } } });
      if (found !== requested.length) return { ok: false, error: "One of the selected teams doesn't exist.", status: 400 };
    }
    return { ok: true, visibility, teamIds: requested, changed: true };
  }

  if (!canChangeAccess(user, doc, visibility)) {
    return {
      ok: false,
      status: 403,
      error:
        doc.visibility === "restricted" && visibility === "org"
          ? EVERYONE_VIA_REQUEST
          : "You don't have permission to change who can see this document.",
    };
  }
  if (visibility === "restricted") {
    // Teams already on the document may stay even if this user isn't in
    // them. A team manager of the document may extend it to any team;
    // anyone else may only add teams they contribute to. Everyone except a
    // superadmin may only remove teams they belong to or added themselves
    // (undoing a mistake), so nobody can strip another team's access to its
    // own confidential document.
    const added = requested.filter((t) => !current.includes(t));
    if (added.length > 0 && managesDocumentTeam(user, doc)) {
      const found = await prisma.team.count({ where: { id: { in: added } } });
      if (found !== added.length) return { ok: false, error: "One of the selected teams doesn't exist.", status: 400 };
    } else if (added.length > 0) {
      const error = await validateTeamSelection(user, added);
      if (error) return { ok: false, error, status: 400 };
    }
    const removed = current.filter((t) => !requested.includes(t));
    const addedByMe = new Set(doc.teamAccess.filter((a) => a.grantedById === user.id).map((a) => a.teamId));
    if (user.role !== "superadmin" && removed.some((t) => !user.teamIds.includes(t) && !addedByMe.has(t))) {
      return { ok: false, error: "You can only remove teams you belong to, or teams you added yourself.", status: 403 };
    }
  }
  return { ok: true, visibility, teamIds: requested, changed: true };
}

/** Writes a change already approved by checkAccessChange(). Making a document
 * restricted turns public sharing off and removes any link (team documents
 * are never shared outside the company). Returns whether sharing was turned
 * off. The caller re-indexes. */
export async function writeAccessChange(
  user: AccessUser,
  documentId: string,
  visibility: "org" | "restricted",
  teamIds: string[],
  // Required when a team document goes to everyone: the global category it
  // joins and its detail fields (lib/teamCategory.ts resolveGlobalCategory).
  globalCategory?: { categoryId: string; metadata: Record<string, unknown> }
): Promise<{ sharingTurnedOff: boolean }> {
  const restricted = visibility === "restricted";
  const keepSharing = !restricted;
  const before = await prisma.document.findUnique({ where: { id: documentId }, select: { shareEnabled: true, categoryId: true } });
  // Team documents sit in the built-in team category; documents for
  // everyone in a real global one.
  let categoryData: Prisma.DocumentUncheckedUpdateInput = {};
  if (restricted) {
    categoryData = { categoryId: await ensureTeamCategory(user.id) };
  } else if (globalCategory) {
    categoryData = { categoryId: globalCategory.categoryId, metadata: globalCategory.metadata as Prisma.InputJsonValue };
  } else if (before?.categoryId === TEAM_CATEGORY_ID) {
    throw Object.assign(new Error("Pick a category for everyone before opening this document to everyone."), { status: 400 });
  }
  await prisma.$transaction([
    prisma.documentTeamAccess.deleteMany({
      where: { documentId, ...(restricted ? { teamId: { notIn: teamIds } } : {}) },
    }),
    ...(restricted
      ? [
          prisma.documentTeamAccess.createMany({
            data: teamIds.map((teamId) => ({ documentId, teamId, grantedById: user.id })),
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.document.update({
      where: { id: documentId },
      data: { visibility, ...categoryData, ...(keepSharing ? {} : { shareEnabled: false }) },
    }),
    ...(keepSharing ? [] : [prisma.shareLink.deleteMany({ where: { documentId } })]),
    // "Also show in" global categories don't apply to team documents.
    ...(restricted ? [prisma.documentCategory.deleteMany({ where: { documentId } })] : []),
  ]);
  return { sharingTurnedOff: !keepSharing && Boolean(before?.shareEnabled) };
}

/** Validates the team list for a restricted document: at least one team,
 * every team must exist, and anyone but a superadmin may only pick teams
 * where they are a contributor or manager (otherwise someone could hand a
 * document to a team they have nothing to do with). Returns an error
 * message, or null when fine. */
export async function validateTeamSelection(user: AccessUser, teamIds: unknown): Promise<string | null> {
  if (!Array.isArray(teamIds) || teamIds.length === 0 || teamIds.some((t) => typeof t !== "string" || !t)) {
    return "Pick at least one team for a restricted document.";
  }
  const unique = [...new Set(teamIds as string[])];
  const found = await prisma.team.count({ where: { id: { in: unique } } });
  if (found !== unique.length) return "One of the selected teams doesn't exist.";
  const allowed = uploadableTeamIds(user);
  if (allowed && unique.some((t) => !allowed.includes(t))) {
    return "You can only upload for teams where you are a contributor or manager.";
  }
  return null;
}
