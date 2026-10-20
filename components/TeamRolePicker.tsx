"use client";

import { Plus, X } from "lucide-react";
import { TEAM_ROLE_OPTIONS, type TeamRoleValue } from "@/lib/roleCopy";

// Teams and the role in each, as rows of two dropdowns: [Team v] [Role v] x.
// "+ Add team" adds a row for a team not picked yet, with no role: the admin
// always picks the role ("" until then). Used by People > Users team editor.
export default function TeamRolePicker({
  teams,
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  teams: { id: string; name: string }[];
  value: Record<string, TeamRoleValue | "">;
  onChange: (next: Record<string, TeamRoleValue | "">) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const rows = Object.entries(value) as [string, TeamRoleValue | ""][];
  const unpicked = teams.filter((t) => !(t.id in value));
  const field = `rounded-ff border border-ff-border bg-white ${compact ? "px-1.5 py-1 text-xs" : "px-2 py-1.5 text-sm"} disabled:opacity-50`;

  // Keeps row order stable while swapping one team for another.
  function replaceTeam(oldId: string, newId: string) {
    onChange(Object.fromEntries(rows.map(([id, role]) => (id === oldId ? [newId, role] : [id, role]))));
  }

  function remove(teamId: string) {
    const next = { ...value };
    delete next[teamId];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-ff-textMuted">Not in any team yet.</p>}
      {rows.map(([teamId, role]) => (
        <div key={teamId} className="flex items-center gap-1.5">
          <select
            aria-label="Team"
            value={teamId}
            disabled={disabled}
            onChange={(e) => replaceTeam(teamId, e.target.value)}
            className={`${field} min-w-0 flex-1`}
          >
            {teams
              .filter((t) => t.id === teamId || !(t.id in value))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Role in this team"
            value={role}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [teamId]: e.target.value as TeamRoleValue })}
            className={`${field} ${role ? "" : "border-ff-danger text-ff-danger"}`}
          >
            <option value="" disabled>
              Pick a role
            </option>
            {TEAM_ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => remove(teamId)}
            disabled={disabled}
            aria-label="Remove from this team"
            title="Remove from this team"
            className="rounded p-1 text-ff-textMuted hover:bg-ff-danger/10 hover:text-ff-danger disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
      {unpicked.length > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...value, [unpicked[0].id]: "" })}
          disabled={disabled}
          className="flex items-center gap-1 text-xs font-medium text-ff-accent hover:underline disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add team
        </button>
      )}
    </div>
  );
}
