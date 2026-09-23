"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/rbac";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

const ROLES: Role[] = ["superadmin", "manager", "contributor", "user"];

// Changing someone's role here (unlike the invite form, which only offers
// three roles and already has its own tooltip) covers all four, including
// promoting someone to Superadmin — exactly the case where the "can't
// approve or delete" carve-out most needs to be visible before you pick it.
const ROLE_HELP = ROLES.map((r) => `${ROLE_LABELS[r]}: ${ROLE_DESCRIPTIONS[r]}`).join(" ");

// Plain text by default, only a dropdown once clicked (a hover-revealed
// pencil is the only hint it's editable) — Manage Users has four of these
// (Role, Designation, Team, Reports To) per row; four permanently-visible
// <select> boxes side by side read as far more to take in at once than
// four short lines of text, one of which happens to be clickable.
export default function RoleSelect({ userId, currentRole, isSelf }: { userId: string; currentRole: Role; isSelf: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-ff-text">
        <span title="You can't change your own role. Ask another superadmin.">{ROLE_LABELS[currentRole]}</span>
        <InfoTooltip text={ROLE_HELP} />
      </span>
    );
  }

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update role, please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <span className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-sm text-ff-text hover:bg-ff-lavender/50">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="truncate">{ROLE_LABELS[currentRole]}</span>
          <Pencil className="h-3 w-3 shrink-0 text-ff-textMuted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        </button>
        <InfoTooltip text={ROLE_HELP} />
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <select
        autoFocus
        defaultValue={currentRole}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        disabled={saving}
        className="w-full min-w-0 rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
