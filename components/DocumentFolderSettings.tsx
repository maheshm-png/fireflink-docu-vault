"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Folder } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

// Manage-tab control for team contributors and managers: which of the team's folders this
// document sits in (Home > My teams). One row per team the viewer may file into,
// since a document shared with several teams is filed by each separately.
// API: app/api/documents/[id]/folder.
export default function DocumentFolderSettings({
  documentId,
  teams,
}: {
  documentId: string;
  teams: { teamId: string; teamName: string; folderId: string | null; folders: { id: string; name: string }[] }[];
}) {
  const router = useRouter();
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(teamId: string, folderId: string | null) {
    setBusyTeam(teamId);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/folder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, folderId }),
    });
    setBusyTeam(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not move the document, please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-lavender text-ff-textMuted">
          <Folder className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
            Folder
            <InfoTooltip text="Where this document sits in your team's documents on Home > My teams." />
          </p>
          <div className="mt-2 space-y-2">
            {teams.map((t) => (
              <label key={t.teamId} className="flex flex-wrap items-center gap-2 text-sm">
                {teams.length > 1 && <span className="w-32 truncate text-ff-textMuted">{t.teamName}</span>}
                <select
                  value={t.folderId ?? ""}
                  disabled={busyTeam === t.teamId}
                  onChange={(e) => move(t.teamId, e.target.value || null)}
                  className="rounded-ff border border-ff-border px-2 py-1 text-sm"
                >
                  <option value="">Not in a folder</option>
                  {t.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {busyTeam === t.teamId && <BrandedLoader size={12} />}
                {t.folders.length === 0 && (
                  <span className="text-xs text-ff-textMuted">No folders yet. A team Manager can create them on Home &gt; My teams.</span>
                )}
              </label>
            ))}
          </div>
        </div>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
