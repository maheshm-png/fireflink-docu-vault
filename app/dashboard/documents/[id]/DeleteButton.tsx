"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

// Soft-delete — unlike Revoke (which just pulls a doc back into review),
// this hides the document everywhere immediately, but it stays recoverable
// from Deleted Documents until the configured retention window passes (see
// /admin/settings), only after which it's purged for good. Server-side
// permission (manager, or the uploader deleting their own still-pending
// submission) is re-checked in the route; this button just mirrors that
// same rule so it doesn't render somewhere it'd 403.
export default function DeleteButton({ documentId, title }: { documentId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not delete this document, please try again.");
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Delete"
        aria-label="Delete"
        className="rounded-ff border border-ff-border p-2 text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>

      <ConfirmModal
        open={confirming}
        title="Delete this document?"
        message={`"${title}" will be hidden immediately but stays recoverable from Deleted Documents for a while before it's permanently removed.`}
        confirmLabel="Yes, delete"
        danger
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
