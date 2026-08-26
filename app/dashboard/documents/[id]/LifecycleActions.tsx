"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ShieldCheck, XCircle } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

export default function LifecycleActions({
  documentId,
  isPermanent,
  showExtend,
  showDismissDuplicate,
}: {
  documentId: string;
  isPermanent: boolean;
  showExtend: boolean;
  showDismissDuplicate: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, extra?: Record<string, unknown>) {
    setBusyAction(action);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/lifecycle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusyAction(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not complete this action — please try again.");
      return;
    }
    setExtending(false);
    router.refresh();
  }

  if (extending) {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ff-textMuted">Push the review out by</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
            className="w-20 rounded-ff border border-ff-border px-2 py-1"
          />
          <span className="text-ff-textMuted">days</span>
          <button
            onClick={() => run("extend", { days })}
            disabled={busyAction !== null}
            className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busyAction === "extend" ? <BrandedLoader size={14} variant="white" /> : "Confirm"}
          </button>
          <button
            onClick={() => setExtending(false)}
            disabled={busyAction !== null}
            className="rounded-ff border border-ff-border px-3 py-1.5 text-ff-text hover:bg-ff-lavender"
          >
            Cancel
          </button>
        </div>
        <AlertModal message={error} onClose={() => setError(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {showExtend && (
          <button
            onClick={() => setExtending(true)}
            className="flex items-center gap-1.5 rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Extend Validity
          </button>
        )}
        <button
          onClick={() => run("toggle-permanent")}
          disabled={busyAction !== null}
          title="Permanent documents are never flagged outdated and are never purged, even when superseded"
          className="flex items-center gap-1.5 rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
        >
          {busyAction === "toggle-permanent" ? <BrandedLoader size={14} /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          {isPermanent ? "Unmark Permanent" : "Mark Permanent (no review)"}
        </button>
        {showDismissDuplicate && (
          <button
            onClick={() => run("dismiss-duplicate")}
            disabled={busyAction !== null}
            className="flex items-center gap-1.5 rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
          >
            {busyAction === "dismiss-duplicate" ? <BrandedLoader size={14} /> : <XCircle className="h-3.5 w-3.5" aria-hidden />}
            Dismiss Duplicate Flag
          </button>
        )}
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
