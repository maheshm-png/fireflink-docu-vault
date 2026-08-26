"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

export default function SettingsForm({
  initialDeletedDocRetentionDays,
  initialOldVersionRetentionDays,
}: {
  initialDeletedDocRetentionDays: number;
  initialOldVersionRetentionDays: number;
}) {
  const router = useRouter();
  const [deletedDocRetentionDays, setDeletedDocRetentionDays] = useState(initialDeletedDocRetentionDays);
  const [oldVersionRetentionDays, setOldVersionRetentionDays] = useState(initialOldVersionRetentionDays);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deletedDocRetentionDays, oldVersionRetentionDays }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save settings — please try again.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSave} className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-4 flex items-center gap-1.5 text-base font-bold text-ff-text">
        Retention
        <InfoTooltip text={'Runs daily via npm run retention:run. Documents marked "permanent" are always exempt from the version cleanup below, regardless of age.'} />
      </h2>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">
            Deleted documents: permanently purge after (days)
          </label>
          <input
            type="number"
            min={1}
            required
            value={deletedDocRetentionDays}
            onChange={(e) => setDeletedDocRetentionDays(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ff-textMuted">
            How long a deleted document stays recoverable (see Deleted Documents) before it&apos;s removed for good.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">
            Old file versions: purge superseded versions after (days)
          </label>
          <input
            type="number"
            min={1}
            required
            value={oldVersionRetentionDays}
            onChange={(e) => setOldVersionRetentionDays(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ff-textMuted">
            Only older, replaced versions are purged. The current version is never removed.
          </p>
        </div>
      </div>

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
        >
          {saving ? <BrandedLoader size={16} variant="white" label="Saving..." /> : "Save Settings"}
        </button>
        {saved && !saving && <span className="text-xs text-ff-success">Saved.</span>}
      </div>
    </form>
  );
}
