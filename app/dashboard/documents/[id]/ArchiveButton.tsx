"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import ConfirmModal from "@/components/ConfirmModal";

export default function ArchiveButton({ documentId, archived }: { documentId: string; archived: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/documents/${documentId}/${archived ? "unarchive" : "archive"}`, { method: "POST" });
    setBusy(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title={archived ? "Unarchive" : "Archive"}
        aria-label={archived ? "Unarchive" : "Archive"}
        className="rounded-ff border border-ff-border p-2 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
      >
        {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
      </button>

      <ConfirmModal
        open={confirming}
        title={archived ? "Restore this document?" : "Archive this document?"}
        message={
          archived
            ? "It'll be sent back for re-approval before it's visible again."
            : "It'll be retired to the Archived section and hidden from the public dashboard."
        }
        confirmLabel={archived ? "Yes, restore" : "Yes, archive"}
        danger={!archived}
        busy={busy}
        onConfirm={toggle}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
