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

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/${archived ? "unarchive" : "archive"}`, { method: "POST" });
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
        onClick={() => setConfirming(true)}
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
            : "It'll be hidden from everyone. If it's published, everyone who could see it is told to stop using it. You can restore it later."
        }
        confirmLabel={archived ? "Yes, restore" : "Yes, archive"}
        danger={!archived}
        busy={busy}
        onConfirm={toggle}
        onCancel={() => setConfirming(false)}
      />
      <AlertModal message={error} onClose={() => setError(null)} title={archived ? "Couldn't restore" : "Couldn't archive"} />
    </>
  );
}
