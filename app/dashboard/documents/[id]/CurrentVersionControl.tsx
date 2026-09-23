"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";

type VersionOption = { id: string; versionNumber: number; label: string };

/**
 * Prominent, header-level shortcut for changing a published document's
 * current version — same underlying action as the "Set as current" link
 * in the Version History table further down the page
 * (SetCurrentVersionButton.tsx / the "set-current-version" lifecycle
 * action in app/api/documents/[id]/lifecycle/route.ts), just surfaced
 * where a manager reviewing the doc actually sees it without scrolling
 * past the review trail and version table first. Picking a version from
 * this select IS the deliberate choice — freely reversible by picking
 * again — so it applies immediately rather than staging a second confirm
 * popup on top of it.
 */
export default function CurrentVersionControl({
  documentId,
  currentVersionNumber,
  currentVersionLabel,
  versions,
}: {
  documentId: string;
  currentVersionNumber: number;
  currentVersionLabel: string;
  versions: VersionOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherVersions = versions.filter((v) => v.versionNumber !== currentVersionNumber);
  if (otherVersions.length === 0) return null;

  async function setCurrent(versionId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/lifecycle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-current-version", versionId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not set this as the current version, please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ff-border bg-white px-2 py-0.5 text-xs text-ff-textMuted">
      Live: {currentVersionLabel}
      <select
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) setCurrent(e.target.value);
        }}
        className="rounded border-none bg-transparent text-xs font-medium text-ff-accent focus:outline-none disabled:opacity-60"
      >
        <option value="">{busy ? "Setting..." : "Change..."}</option>
        {otherVersions.map((v) => (
          <option key={v.id} value={v.id}>Set {v.label} live</option>
        ))}
      </select>

      <AlertModal message={error} onClose={() => setError(null)} />
    </span>
  );
}
