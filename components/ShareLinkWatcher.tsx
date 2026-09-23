"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

// Same 45s cadence components/NotificationBell.tsx, AnnouncementTicker.tsx,
// and NewDocumentsProvider.tsx poll at, to keep this from adding back the
// Supabase connection-pool pressure those were raised from 30s to relieve.
const POLL_INTERVAL_MS = 45_000;
// How long the banner gives someone to reload on their own before it just
// does it for them.
const AUTO_RELOAD_SECONDS = 5;

type Status =
  | { available: true; accessLevel: "view" | "view_download"; expiresAt: string | null }
  | { available: false };

/**
 * Keeps a tab already open on a public share link honest about whatever the
 * owner does to it afterward — tighten/loosen access, change the expiry, or
 * stop sharing entirely (components/ShareModal.tsx) — rather than the page
 * silently staying stale (still showing a download button after access was
 * downgraded to view-only, say) until the viewer happens to refresh on
 * their own. Polls app/api/share/[token]/status/route.ts, a tiny endpoint
 * built for exactly this rather than reusing the full page or /view.
 *
 * Shows a banner first (an unannounced reload mid-read would lose scroll
 * position/zoom/whatever page someone's on), but it's a countdown, not an
 * open-ended offer — reload happens on its own once AUTO_RELOAD_SECONDS
 * passes, same as it would if they'd clicked Reload themselves.
 */
export default function ShareLinkWatcher({
  token,
  initialAccessLevel,
  initialExpiresAt,
}: {
  token: string;
  initialAccessLevel: "view" | "view_download";
  initialExpiresAt: string | null;
}) {
  const [changed, setChanged] = useState<"settings" | "unavailable" | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RELOAD_SECONDS);
  // Once a change is detected there's nothing further worth polling for —
  // the banner already covers "something changed, go reload."
  const stoppedRef = useRef(false);

  const poll = useCallback(async () => {
    if (stoppedRef.current) return;
    try {
      const res = await fetch(`/api/share/${token}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data: Status = await res.json();
      if (!data.available) {
        stoppedRef.current = true;
        setChanged("unavailable");
        return;
      }
      const expiryChanged = (data.expiresAt ?? null) !== (initialExpiresAt ?? null);
      if (data.accessLevel !== initialAccessLevel || expiryChanged) {
        stoppedRef.current = true;
        setChanged("settings");
      }
    } catch {
      // A transient network hiccup shouldn't itself claim the link
      // changed — just try again on the next tick.
    }
  }, [token, initialAccessLevel, initialExpiresAt]);

  useEffect(() => {
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    // Also re-check whenever the tab regains focus — the most likely
    // moment the owner actually changed something in another tab while
    // this one sat in the background.
    function onVisibility() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  // Ticks the countdown once the banner appears and reloads on its own
  // when it hits zero — the banner is a heads-up, not an indefinite wait.
  useEffect(() => {
    if (!changed) return;
    if (secondsLeft <= 0) {
      window.location.reload();
      return;
    }
    const timeout = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timeout);
  }, [changed, secondsLeft]);

  if (!changed) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-ff-warning px-4 py-2.5 text-center text-sm font-medium text-white shadow-ff-md">
      <span>
        {changed === "unavailable"
          ? "This link is no longer available."
          : "This link's access has changed."}
        {" "}Reloading in {secondsLeft}s.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-ff bg-white/20 px-3 py-1 text-xs font-semibold transition-colors hover:bg-white/30"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Reload Now
      </button>
    </div>
  );
}
