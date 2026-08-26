"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

// Lets a manager/superadmin roll the live document back (or forward) to any
// already-uploaded version without a new upload/review cycle — e.g. a fresh
// version turns out to have an error and the previous one should go back to
// being what's served/searched/downloaded right away. See the
// "set-current-version" case in app/api/documents/[id]/lifecycle/route.ts.
export default function SetCurrentVersionButton({
  documentId,
  versionId,
  versionNumber,
}: {
  documentId: string;
  versionId: string;
  versionNumber: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
      setError(data?.error ?? "Could not set this as the current version — please try again.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="ml-2 text-xs text-ff-accent hover:underline"
      >
        Set as current
      </button>

      <ConfirmModal
        open={confirming}
        title={`Make v${versionNumber} the live version?`}
        message="This immediately replaces what's served, searched, and downloaded for this document — no new review needed."
        confirmLabel="Yes, set as current"
        danger={false}
        busy={busy}
        onConfirm={setCurrent}
        onCancel={() => setConfirming(false)}
      />

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
