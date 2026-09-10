"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

type VersionOption = { id: string; versionNumber: number };

/**
 * Prominent, header-level shortcut for changing a published document's
 * current version — same underlying action as the "Set as current" link
 * in the Version History table further down the page
 * (SetCurrentVersionButton.tsx / the "set-current-version" lifecycle
 * action in app/api/documents/[id]/lifecycle/route.ts), just surfaced
 * where a manager reviewing the doc actually sees it without scrolling
 * past the review trail and version table first.
 */
export default function CurrentVersionControl({
  documentId,
  currentVersionNumber,
  versions,
}: {
  documentId: string;
  currentVersionNumber: number;
  versions: VersionOption[];
}) {
  const router = useRouter();
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherVersions = versions.filter((v) => v.versionNumber !== currentVersionNumber);
  if (otherVersions.length === 0) return null;

  const pendingVersion = versions.find((v) => v.id === pendingVersionId);

  async function confirmChange() {
    if (!pendingVersionId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/lifecycle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-current-version", versionId: pendingVersionId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not set this as the current version — please try again.");
      return;
    }
    setPendingVersionId(null);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ff-border bg-white px-2 py-0.5 text-xs text-ff-textMuted">
      Live: v{currentVersionNumber}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) setPendingVersionId(e.target.value);
        }}
        className="rounded border-none bg-transparent text-xs font-medium text-ff-accent focus:outline-none"
      >
        <option value="">Change...</option>
        {otherVersions.map((v) => (
          <option key={v.id} value={v.id}>Set v{v.versionNumber} live</option>
        ))}
      </select>

      <ConfirmModal
        open={Boolean(pendingVersionId)}
        title={pendingVersion ? `Make v${pendingVersion.versionNumber} the live version?` : ""}
        message="This immediately replaces what's served, searched, and downloaded for this document — no new review needed."
        confirmLabel="Yes, set as current"
        danger={false}
        busy={busy}
        onConfirm={confirmChange}
        onCancel={() => setPendingVersionId(null)}
      />

      <AlertModal message={error} onClose={() => setError(null)} />
    </span>
  );
}
