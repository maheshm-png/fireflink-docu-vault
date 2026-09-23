"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import AlertModal from "@/components/AlertModal";

// Plain text by default, only a dropdown once clicked — see RoleSelect.tsx's
// own comment for why (four of these side by side per row otherwise reads
// as much busier than it needs to).
export default function DesignationSelect({
  userId,
  currentDesignationId,
  options,
}: {
  userId: string;
  currentDesignationId: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentName = options.find((o) => o.id === currentDesignationId)?.name ?? "None";

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const designationId = e.target.value || null;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designationId }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update designation, please try again.");
      return;
    }
    setEditing(false);
    router.refresh();
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
        defaultValue={currentDesignationId ?? ""}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        disabled={saving}
        className="w-full min-w-0 rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
