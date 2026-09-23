"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

// Manage-tab sharing control — a manager or this document's own uploader
// can turn "anyone with the link" sharing on/off any time after publish,
// not just the one-time choice made at approval (see ReviewActions.tsx's
// "share" prompt). Same permission model and toggle-switch styling as
// FeedbackManagement.tsx's own feedback toggle. Turning this off also
// deactivates any link already issued (app/api/documents/[id]/share/
// route.ts's PATCH handler deletes it), not just future ones — reflected
// here by hiding the Share button entirely wherever it's rendered
// (app/dashboard/documents/[id]/page.tsx), since there's nothing left to
// manage from there once sharing is off.
export default function ShareSettings({
  documentId,
  initialShareEnabled,
}: {
  documentId: string;
  initialShareEnabled: boolean;
}) {
  const router = useRouter();
  const [shareEnabled, setShareEnabled] = useState(initialShareEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleShare() {
    setBusy(true);
    setError(null);
    const next = !shareEnabled;
    const res = await fetch(`/api/documents/${documentId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareEnabled: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this setting, please try again.");
      return;
    }
    setShareEnabled(next);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-ff ${
              shareEnabled ? "bg-ff-success/10 text-ff-success" : "bg-ff-lavender text-ff-textMuted"
            }`}
          >
            <Share2 className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ff-text">Allow Sharing</p>
            <p className="text-xs text-ff-textMuted">
              Lets anyone who can view this document create and manage a public &quot;anyone with the link&quot;
              share. Turn off to hide the Share button and immediately deactivate any link already issued.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shareEnabled}
          aria-label={shareEnabled ? "Turn off sharing" : "Turn on sharing"}
          onClick={toggleShare}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            shareEnabled ? "bg-ff-success" : "bg-ff-border"
          }`}
        >
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <BrandedLoader size={12} variant="white" />
            </span>
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                shareEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          )}
        </button>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
