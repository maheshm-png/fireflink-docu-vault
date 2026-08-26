"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import AlertModal from "@/components/AlertModal";

const ROLES: Role[] = ["superadmin", "manager", "contributor", "user"];

export default function RoleSelect({ userId, currentRole, isSelf }: { userId: string; currentRole: Role; isSelf: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return <span title="You can't change your own role. Ask another superadmin.">{ROLE_LABELS[currentRole]}</span>;
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
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update role — please try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      <select
        defaultValue={currentRole}
        onChange={handleChange}
        disabled={saving}
        className="rounded-ff border border-ff-border px-2 py-1 text-sm disabled:opacity-60"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
