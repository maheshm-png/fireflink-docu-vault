"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

export default function RevokeButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!reason.trim()) {
      setError("A reason is required — it's shown to everyone browsing revoked documents.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not revoke this document — please try again.");
      return;
    }
    setConfirming(false);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Revoke"
        aria-label="Revoke"
        className="rounded-ff border border-ff-border p-2 text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger"
      >
        <Undo2 className="h-4 w-4" aria-hidden />
      </button>

      <ConfirmModal
        open={confirming}
        title="Revoke this document?"
        message="It'll be pulled from the public dashboard immediately and sent back for re-approval. This reason is shown to everyone browsing revoked documents."
        confirmLabel="Yes, revoke"
        busy={busy}
        onConfirm={revoke}
        onCancel={() => {
          setConfirming(false);
          setReason("");
        }}
      >
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for revoking"
          autoFocus
          className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
        />
      </ConfirmModal>

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
