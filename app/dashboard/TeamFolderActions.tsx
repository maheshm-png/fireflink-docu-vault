"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import AlertModal from "@/components/AlertModal";
import ConfirmModal from "@/components/ConfirmModal";
import BrandedLoader from "@/components/BrandedLoader";

// Team managers' folder controls in Home > My teams: create a folder, and
// rename or delete the one that's open. Deleting only takes its documents
// out of the folder. API: app/api/teams/[id]/folders.
export default function TeamFolderActions({
  teamId,
  activeFolder,
}: {
  teamId: string;
  activeFolder: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(
      mode === "rename" && activeFolder ? `/api/teams/${teamId}/folders/${activeFolder.id}` : `/api/teams/${teamId}/folders`,
      {
        method: mode === "rename" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save the folder, please try again.");
      return;
    }
    setMode(null);
    setName("");
    router.refresh();
  }

  async function remove() {
    if (!activeFolder) return;
    setBusy(true);
    const res = await fetch(`/api/teams/${teamId}/folders/${activeFolder.id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not delete the folder, please try again.");
      return;
    }
    router.push(`/dashboard?space=teams&team=${teamId}`);
    router.refresh();
  }

  if (mode) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          maxLength={60}
          className="w-40 rounded-ff border border-ff-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex items-center rounded-ff bg-ff-accent-gradient px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {busy ? <BrandedLoader size={12} variant="white" /> : mode === "rename" ? "Rename" : "Create"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="px-2 py-1 text-xs text-ff-textMuted hover:text-ff-text">
          Cancel
        </button>
        <AlertModal message={error} onClose={() => setError(null)} />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          setName("");
          setMode("new");
        }}
        className="flex items-center gap-1 rounded-ff border border-dashed border-ff-accent/50 px-2.5 py-1 text-xs font-medium text-ff-accent hover:bg-ff-accent/5"
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden />
        New folder
      </button>
      {activeFolder && (
        <>
          <button
            type="button"
            onClick={() => {
              setName(activeFolder.name);
              setMode("rename");
            }}
            title="Rename this folder"
            aria-label="Rename this folder"
            className="rounded p-1.5 text-ff-textMuted hover:bg-ff-lavender hover:text-ff-text"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title="Delete this folder"
            aria-label="Delete this folder"
            className="rounded p-1.5 text-ff-textMuted hover:bg-ff-danger/10 hover:text-ff-danger"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete the folder "${activeFolder?.name ?? ""}"?`}
        message="Its documents stay in the team, just not in a folder."
        confirmLabel="Yes, delete folder"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
