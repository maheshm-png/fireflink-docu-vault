"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";
import BrandedLoader from "@/components/BrandedLoader";

export type LeadershipValue = { mode: "off" | "all" | "selected"; teamIds: string[] };

// Leadership view (lib/access.ts): view, download and comment on team
// documents without being in the team, nothing more. Off, every team, or
// only the teams picked. The picker on its own is used by the invite form;
// LeadershipViewCell below saves it from the People table.
export function LeadershipViewPicker({
  teams,
  value,
  onChange,
  disabled = false,
}: {
  teams: { id: string; name: string }[];
  value: LeadershipValue;
  onChange: (next: LeadershipValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <select
        value={value.mode}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, mode: e.target.value as LeadershipValue["mode"] })}
        className="w-full rounded-ff border border-ff-border px-2 py-1.5 text-sm"
        aria-label="Leadership view"
      >
        <option value="off">Off</option>
        <option value="all">All teams</option>
        <option value="selected">Selected teams</option>
      </select>
      {value.mode === "selected" && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-ff border border-ff-border p-2">
          {teams.length === 0 && <p className="text-xs text-ff-textMuted">No teams yet.</p>}
          {teams.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.teamIds.includes(t.id)}
                onChange={() =>
                  onChange({
                    ...value,
                    teamIds: value.teamIds.includes(t.id) ? value.teamIds.filter((x) => x !== t.id) : [...value.teamIds, t.id],
                  })
                }
              />
              {t.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function leadershipBody(v: LeadershipValue) {
  return { seesAllTeams: v.mode === "all", viewTeamIds: v.mode === "selected" ? v.teamIds : [] };
}

export default function LeadershipViewCell({
  userId,
  seesAllTeams,
  viewTeamIds,
  teams,
}: {
  userId: string;
  seesAllTeams: boolean;
  viewTeamIds: string[];
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const initial: LeadershipValue = { mode: seesAllTeams ? "all" : viewTeamIds.length ? "selected" : "off", teamIds: viewTeamIds };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<LeadershipValue>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    initial.mode === "all"
      ? "All teams"
      : initial.mode === "selected"
        ? teams.filter((t) => viewTeamIds.includes(t.id)).map((t) => t.name).join(", ")
        : "Off";

  async function save() {
    if (value.mode === "selected" && value.teamIds.length === 0) {
      setError("Pick at least one team, or choose Off.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leadershipBody(value)),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save, please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(initial);
          setEditing(true);
        }}
        title="View, download and comment on these teams' documents, without being in them"
        className={`w-full truncate rounded px-1.5 py-1 text-left text-sm hover:bg-ff-lavender/50 ${
          initial.mode === "off" ? "text-ff-textMuted" : "font-medium text-ff-accent"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="min-w-0 rounded-ff border border-ff-border bg-white p-2 shadow-ff">
      <LeadershipViewPicker teams={teams} value={value} onChange={setValue} disabled={saving} />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center rounded-ff bg-ff-accent-gradient px-3 py-1 text-xs text-white disabled:opacity-50"
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
