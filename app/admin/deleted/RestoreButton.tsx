"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

export default function RestoreButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/restore`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not restore this document — please try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={restore}
        disabled={busy}
        title="Restore"
        aria-label="Restore"
        className="flex items-center gap-1.5 rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
      >
        {busy ? <BrandedLoader size={14} /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
        Restore
      </button>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
