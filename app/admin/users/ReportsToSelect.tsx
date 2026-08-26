"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";

/** Which manager this contributor's uploads default to for review — pre-
 * selected as the suggested reviewer on the upload form (see
 * app/dashboard/upload/UploadForm.tsx), though they can still pick anyone
 * else instead. Only meaningful for contributors: managers already have a
 * free choice of any other manager at review time (reassign / request a
 * second opinion — see app/api/documents/[id]/review/route.ts), so they
 * don't need a fixed reporting line the way a contributor's default
 * reviewer does. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(data?.error ?? "Could not update — please try again.");
      return;
    }
    router.refresh();
  }

  const choices = options.filter((o) => o.id !== userId);
  if (choices.length === 0) {
    return <span className="text-xs text-ff-textMuted">No other managers yet</span>;
  }

  return (
    <div>
      <select
        defaultValue={currentReportsToId ?? ""}
        onChange={handleChange}
        disabled={saving}
        className="rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        <option value="">— none —</option>
        {choices.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
