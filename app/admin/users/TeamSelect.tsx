"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import AlertModal from "@/components/AlertModal";
import BrandedLoader from "@/components/BrandedLoader";
import { TEAM_ROLE_OPTIONS, type TeamRoleValue } from "@/lib/roleCopy";
import TeamRolePicker from "@/components/TeamRolePicker";
import InfoTooltip from "@/components/InfoTooltip";

// Plain text by default, only an editor once clicked — see RoleSelect.tsx's
// own comment for why (four of these side by side per row otherwise reads
// as much busier than it needs to). A person can be in several teams
// (UserTeam), so the editor is a checklist rather than a dropdown. Team
// membership decides which restricted documents they see, and the team role
// next to each team what they may do with them (lib/access.ts):
//   Contributor sees the team's documents and uploads for the team
//   Manager     also approves them, extends them to other teams and
//               requests them for everyone
// View only is for leadership ("Sees all teams"), never a team role. Nothing
// is pre-filled: a new team, or an old "member" row, shows "Pick a role"
// and can't be saved until the admin picks one.
// Separate from the org role (RoleSelect), which governs documents visible to
// everyone. "Sees all teams" is a separate column (SeesAllTeamsToggle).
type TeamRole = "member" | "contributor" | "manager";
const TEAM_ROLE_LABELS: Record<TeamRole, string> = { member: "Member", contributor: "Contributor", manager: "Manager" };

export default function TeamSelect({
  userId,
  currentTeamIds,
  currentTeamRoles = {},
  options,
}: {
  userId: string;
  currentTeamIds: string[];
  currentTeamRoles?: Record<string, TeamRole>;
  orgRole?: string;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Team id -> role, for the teams they're in (TeamRolePicker edits this).
  const assignedFrom = () =>
    Object.fromEntries(
      currentTeamIds.map((t) => [t, currentTeamRoles[t] === "member" ? "" : currentTeamRoles[t] ?? ""])
    ) as Record<string, TeamRoleValue | "">;
  const [assigned, setAssigned] = useState<Record<string, TeamRoleValue | "">>(assignedFrom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  async function save() {
    if (Object.values(assigned).some((r) => !r)) {
      setError("Pick a role for every team.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamIds: Object.keys(assigned),
        teamRoles: assigned,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update teams, please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  // Read view: one line per team, team name and role in their own columns
  // (the table gives this cell the Team and Team role columns).
  if (!editing) {
    const rows = options.filter((o) => currentTeamIds.includes(o.id));
    return (
      <button
        type="button"
        onClick={() => {
          setAssigned(assignedFrom());
          setEditing(true);
        }}
        title="Change teams"
        className="group w-full min-w-0 rounded px-1.5 py-1 text-left text-sm hover:bg-ff-lavender/50"
      >
        {rows.length === 0 ? (
          <span className="grid grid-cols-[130px_1fr] gap-3 text-ff-textMuted">
            <span>No team</span>
            <span className="flex items-center gap-1.5">
              -
              <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </span>
          </span>
        ) : (
          rows.map((o, i) => (
            <span key={o.id} className="grid grid-cols-[130px_1fr] gap-3">
              <span className="truncate text-ff-text" title={o.name}>
                {o.name}
              </span>
              <span className="flex items-center gap-1.5 text-ff-textMuted">
                {TEAM_ROLE_LABELS[currentTeamRoles[o.id] ?? "member"]}
                {i === 0 && <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
              </span>
            </span>
          ))
        )}
      </button>
    );
  }

  return (
    <div className="min-w-0 rounded-ff border border-ff-border bg-white p-2 shadow-ff">
      <div className="max-h-56 overflow-y-auto">
        {options.length === 0 ? (
          <p className="text-xs text-ff-textMuted">No teams yet. Add some under Teams.</p>
        ) : (
          <TeamRolePicker teams={options} value={assigned} onChange={setAssigned} disabled={saving} compact />
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <InfoTooltip text={TEAM_ROLE_OPTIONS.map((r) => `${r.label}: ${r.short}`).join(" ")} />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {saving ? <BrandedLoader size={12} variant="white" /> : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="rounded-ff border border-ff-border px-3 py-1 text-xs text-ff-text hover:bg-ff-lavender"
        >
          Cancel
        </button>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
