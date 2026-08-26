"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(data?.error ?? "Could not update designation — please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <select
        defaultValue={currentDesignationId ?? ""}
        onChange={handleChange}
        disabled={saving}
        className="rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
