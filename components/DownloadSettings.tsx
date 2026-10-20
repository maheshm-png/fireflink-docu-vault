"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, EyeOff } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import InfoTooltip from "@/components/InfoTooltip";
import AlertModal from "@/components/AlertModal";

// Manage-tab control for whether a document can be downloaded or is preview
// only (lib/access.ts downloadsAllowed). Saves through PATCH
// /api/documents/[id]/access with { downloadable }. Restricted documents are
// always preview only, so the toggle is shown locked for them.
export default function DownloadSettings({
  documentId,
  initialDownloadable,
}: {
  documentId: string;
  initialDownloadable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = initialDownloadable;

  async function set(downloadable: boolean) {
    if (downloadable === current) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downloadable }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not change downloads, please try again.");
      return;
    }
    router.refresh();
  }

  const options = [
    { value: true, label: "Allow download", Icon: Download },
    { value: false, label: "Preview only", Icon: EyeOff },
  ];

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-lavender text-ff-textMuted">
          {current ? <Download className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ff-text">
            Downloads
            <InfoTooltip text="Preview only means people can view the document but nobody can download it, including through share links." />
            {busy && <BrandedLoader size={12} />}
          </p>
          <div className="mt-2 inline-flex rounded-ff border border-ff-border p-0.5">
            {options.map(({ value, label, Icon }) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => set(value)}
                aria-pressed={current === value}
                className={`flex items-center gap-1.5 rounded-ff px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                  current === value ? "bg-ff-accent text-white" : "text-ff-textMuted hover:text-ff-text"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
