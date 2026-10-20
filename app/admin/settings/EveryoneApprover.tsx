"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

// Superadmin-only Settings card: the one org manager who decides every team's
// "Request for Everyone" (User.isGlobalApprover, lib/access.ts
// decidesEveryoneRequests). Saved through app/api/admin/everyone-approver.
export default function EveryoneApprover({
  managers,
  currentId,
  currentInvalidName,
}: {
  managers: { id: string; name: string }[];
  currentId: string | null;
  // Set when the picked person is no longer an active manager.
  currentInvalidName: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(currentInvalidName ? "" : currentId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/everyone-approver", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: picked || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save the Global approver, please try again.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold text-ff-text">
        Global approver
        <InfoTooltip text="One manager who can be picked as the reviewer for any team's upload, and who decides when a team asks for one of its documents to be visible to everyone. They only see the team documents they're assigned." />
      </h2>
      {currentInvalidName && (
        <p className="mb-3 text-xs text-ff-warning">
          {currentInvalidName} is no longer an active manager, so they can&apos;t approve. Pick someone else.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            setSaved(false);
          }}
          disabled={saving}
          className="min-w-[14rem] rounded-ff border border-ff-border px-3 py-2 text-sm"
        >
          <option value="">Nobody (requests can&apos;t be raised)</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={saving || (!currentInvalidName && picked === (currentId ?? ""))}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? <BrandedLoader size={14} variant="white" /> : "Save"}
        </button>
        {saved && <span className="text-xs text-ff-success">Saved</span>}
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
