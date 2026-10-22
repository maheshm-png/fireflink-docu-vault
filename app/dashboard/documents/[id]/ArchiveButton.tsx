"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";

export default function ArchiveButton({ documentId, archived }: { documentId: string; archived: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/${archived ? "unarchive" : "archive"}`, {
      method: "POST",
      ...(archived ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }),
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? (archived ? "Could not restore this document." : "Could not archive this document."));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => {
          setNote("");
          setConfirming(true);
        }}
        title={archived ? "Restore" : "Archive"}
        aria-label={archived ? "Restore" : "Archive"}
        className="rounded-ff border border-ff-border p-2 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
      >
        {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
      </button>

      <ConfirmModal
        open={confirming}
        title={archived ? "Restore this document?" : "Archive this document?"}
        message={
          archived
            ? "It stays hidden until it's re-approved."
            : "Everyone who could see it can still view it, but no one can download or share it. If it's published, they're told to stop using any copy. You can restore it later."
        }
        confirmLabel={archived ? "Yes, restore" : "Yes, archive"}
        danger={!archived}
        busy={busy}
        onConfirm={toggle}
        onCancel={() => setConfirming(false)}
      >
        {!archived && (
          <div>
            <label htmlFor="archive-note" className="mb-1 block text-xs font-medium text-ff-textMuted">
              Note (optional)
            </label>
            <textarea
              id="archive-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Why it's archived, e.g. replaced by the 2027 pricing deck"
              className="w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm text-ff-text focus:border-ff-accent focus:outline-none"
            />
          </div>
        )}
      </ConfirmModal>
      <AlertModal message={error} onClose={() => setError(null)} title={archived ? "Couldn't restore" : "Couldn't archive"} />
    </>
  );
}
