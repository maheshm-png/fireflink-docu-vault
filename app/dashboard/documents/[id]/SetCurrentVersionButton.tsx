"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";

// Lets a manager/superadmin roll the live document back (or forward) to any
// already-uploaded version without a new upload/review cycle — e.g. a fresh
// version turns out to have an error and the previous one should go back to
// being what's served/searched/downloaded right away. See the
// "set-current-version" case in app/api/documents/[id]/lifecycle/route.ts.
// Single click, no confirm step — this is freely reversible (pick another
// version, or switch back) by the same manager/superadmin tier that's
// already past a permission gate to see this control at all.
export default function SetCurrentVersionButton({
  documentId,
  versionId,
  versionLabel,
}: {
  documentId: string;
  versionId: string;
  versionLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setCurrent() {
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
    <>
      <button
        type="button"
        onClick={setCurrent}
        disabled={busy}
        title={`Make ${versionLabel} the live version`}
        className="ml-2 text-xs text-ff-accent hover:underline disabled:opacity-60"
      >
        {busy ? "Setting..." : "Set as current"}
      </button>

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
