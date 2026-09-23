"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ShieldCheck, XCircle } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

// The common case for extending a review deadline is "push it out by a
// round number of days" — offering these as one-click chips instead of
// making everyone open an editor, type a number, then confirm cuts that
// down from two required steps to one for the vast majority of uses.
// Custom is still there for anything else.
const QUICK_EXTEND_DAYS = [30, 60, 90];

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
  const [customizing, setCustomizing] = useState(false);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  // Flips the instant the switch is clicked rather than waiting on
  // router.refresh() to bring back fresh server data — that round trip is
  // easy to mistake for "nothing happened" and click again, which just
  // flips it right back. Synced from the real isPermanent prop whenever the
  // server value actually changes underneath it (including this refresh
  // landing), and reverted on a failed request.
  const [optimisticPermanent, setOptimisticPermanent] = useState(isPermanent);
  useEffect(() => setOptimisticPermanent(isPermanent), [isPermanent]);

  async function run(action: string, busyKey: string, extra?: Record<string, unknown>) {
    setBusyAction(busyKey);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/lifecycle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusyAction(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not complete this action, please try again.");
      if (action === "toggle-permanent") setOptimisticPermanent(isPermanent);
      return;
    }
    setCustomizing(false);
    router.refresh();
  }

  function togglePermanent() {
    setOptimisticPermanent((v) => !v);
    run("toggle-permanent", "toggle-permanent");
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-ff ${
              optimisticPermanent ? "bg-ff-success/10 text-ff-success" : "bg-ff-lavender text-ff-textMuted"
            }`}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ff-text">Permanent Retention</p>
            <p className="text-xs text-ff-textMuted">
              Never flagged as outdated or purged, even once a newer version is approved.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={optimisticPermanent}
          aria-label={optimisticPermanent ? "Turn off permanent retention" : "Turn on permanent retention"}
          onClick={togglePermanent}
          disabled={busyAction !== null}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            optimisticPermanent ? "bg-ff-success" : "bg-ff-border"
          }`}
        >
          {busyAction === "toggle-permanent" ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <BrandedLoader size={12} variant="white" />
            </span>
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                optimisticPermanent ? "translate-x-6" : "translate-x-1"
              }`}
            />
          )}
        </button>
      </div>

      {showExtend && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-warning/10 text-ff-warning">
              <CalendarClock className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ff-text">Review Validity</p>
              <p className="text-xs text-ff-textMuted">This document&apos;s review is due soon or overdue. Push the deadline out.</p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {QUICK_EXTEND_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => run("extend", `extend-${d}`, { days: d })}
                    disabled={busyAction !== null}
                    className="flex items-center justify-center rounded-full border border-ff-border bg-white px-3 py-1 text-xs font-medium text-ff-text transition-colors hover:border-ff-accent/40 hover:text-ff-accent disabled:opacity-60"
                  >
                    {busyAction === `extend-${d}` ? <BrandedLoader size={12} /> : `+${d} days`}
                  </button>
                ))}

                {customizing ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={days}
                      onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
                      className="w-16 rounded-ff border border-ff-border px-2 py-1 text-xs"
                    />
                    <span className="text-xs text-ff-textMuted">days</span>
                    <button
                      type="button"
                      onClick={() => run("extend", "extend-custom", { days })}
                      disabled={busyAction !== null}
                      className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busyAction === "extend-custom" ? <BrandedLoader size={12} variant="white" /> : "Apply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomizing(false)}
                      disabled={busyAction !== null}
                      className="text-xs text-ff-textMuted hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCustomizing(true)}
                    className="text-xs font-medium text-ff-accent hover:underline"
                  >
                    Custom
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showDismissDuplicate && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-danger/10 text-ff-danger">
              <XCircle className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-ff-text">Duplicate Flag</p>
              <p className="text-xs text-ff-textMuted">Flagged as a possible duplicate of another document.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => run("dismiss-duplicate", "dismiss-duplicate")}
            disabled={busyAction !== null}
            className="flex shrink-0 items-center justify-center rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
          >
            {busyAction === "dismiss-duplicate" ? <BrandedLoader size={14} /> : "Dismiss"}
          </button>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
