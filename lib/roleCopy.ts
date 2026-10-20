// The two levels of access, in the plain words shown wherever someone picks
// or reads a role (invite form, People > Users team editor, profile menu,
// Help). One copy so they never drift. The rules themselves live in
// lib/rbac.ts (org role) and lib/access.ts (team role).

export const ORG_LEVEL = {
  title: "Org role",
  covers: "Documents for everyone in FireFlink",
};

export const TEAM_LEVEL = {
  title: "Team roles",
  covers: "Each team's own confidential documents",
};

export const ORG_ROLE_OPTIONS = [
  { value: "user", label: "User", short: "Views, searches and shares published documents. Can't upload for everyone." },
  { value: "contributor", label: "Contributor", short: "Also uploads for everyone. A manager approves each upload." },
  { value: "manager", label: "Manager", short: "Also approves uploads for everyone, and can publish their own without review." },
] as const;

// Everyone in a team can upload to it. View only is for leadership (Sees all
// teams / selected teams in People), never a team role, so "member" is no
// longer given out; rows from before this may still carry it until migrated.
export const TEAM_ROLE_OPTIONS = [
  { value: "contributor", label: "Contributor", short: "Sees the team's documents and uploads for the team. A team manager approves." },
  { value: "manager", label: "Manager", short: "Also approves the team's uploads, runs its folders, can publish without review." },
] as const;

export type TeamRoleValue = (typeof TEAM_ROLE_OPTIONS)[number]["value"];

export const TEAM_ROLE_LABEL: Record<TeamRoleValue | "member", string> = {
  member: "Member",
  contributor: "Contributor",
  manager: "Manager",
};
