"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";

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
      setError(data?.error ?? "Could not delete this document — please try again.");
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

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-ff bg-white p-5 shadow-ff-lg"
          >
            <h2 className="mb-2 text-base font-semibold text-ff-text">Delete this document?</h2>
            <p className="mb-4 text-sm text-ff-textMuted">
              &quot;{title}&quot; will be hidden immediately but stays recoverable from Deleted Documents for a
              while before it&apos;s permanently removed.
            </p>
            {error && <p className="mb-3 text-sm text-ff-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text hover:bg-ff-lavender disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="flex items-center justify-center rounded-ff bg-ff-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <BrandedLoader size={16} variant="white" /> : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
