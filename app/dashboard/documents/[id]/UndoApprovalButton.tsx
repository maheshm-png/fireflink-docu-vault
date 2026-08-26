"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

export default function UndoApprovalButton({
  documentId,
  otherPendingReviewers,
}: {
  documentId: string;
  otherPendingReviewers: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo-approval" }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not undo your approval — please try again.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <p className="text-sm text-ff-textMuted">
        You&apos;ve approved this document.{" "}
        {otherPendingReviewers > 0
          ? `Waiting on ${otherPendingReviewers} other reviewer${otherPendingReviewers === 1 ? "" : "s"} before it publishes.`
          : "It will publish shortly."}
      </p>
      <button
        onClick={() => setConfirming(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-ff border border-ff-border px-3 py-2 text-sm text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger"
      >
        <Undo2 className="h-4 w-4" aria-hidden />
        Undo My Approval
      </button>

      <ConfirmModal
        open={confirming}
        title="Undo your approval?"
        message="Your review goes back to pending. You'll need to approve or reject again before this document can publish."
        confirmLabel="Undo Approval"
        danger
        busy={busy}
        onConfirm={undo}
        onCancel={() => setConfirming(false)}
      />
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
