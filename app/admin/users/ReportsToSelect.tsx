"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import AlertModal from "@/components/AlertModal";

/** Who this person reports to on the org chart — shown for every role
 * (app/admin/users/page.tsx, except whoever holds the "Chief Executive
 * Officer" designation). For a contributor specifically, this also doubles
 * as which manager their uploads default to for review, pre-selected as
 * the suggested reviewer on the upload form (see
 * app/dashboard/upload/UploadForm.tsx), though they can still pick anyone
 * else instead. `options` isn't restricted to role "manager"/"superadmin" —
 * see page.tsx's own comment on reportsToOptions for why. Plain text by
 * default, only a dropdown once clicked — see RoleSelect.tsx's own comment
 * for why. */
export default function ReportsToSelect({
  userId,
  currentReportsToId,
  options,
}: {
  userId: string;
  currentReportsToId: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = options.filter((o) => o.id !== userId);
  const currentName = choices.find((o) => o.id === currentReportsToId)?.name ?? "None";

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const reportsToId = e.target.value || null;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportsToId }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update, please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (choices.length === 0) {
    return <span className="text-xs text-ff-textMuted">No other users yet</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm text-ff-textMuted hover:bg-ff-lavender/50"
      >
        <span className="truncate">{currentName}</span>
        <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
    );
  }

  return (
    <div className="min-w-0">
      <select
        autoFocus
        defaultValue={currentReportsToId ?? ""}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        disabled={saving}
        className="w-full min-w-0 rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        <option value="">None</option>
        {choices.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
