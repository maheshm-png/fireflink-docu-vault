"use client";

import { useEffect, useState, type ReactNode } from "react";
import Badge from "@/components/Badge";

export type DetailTab = {
  key: string;
  label: string;
  // A pre-rendered icon element (e.g. `<Info className="h-4 w-4" aria-hidden />`),
  // not a component reference — page.tsx is a Server Component, and React
  // can pass rendered elements across that boundary into a Client
  // Component but not raw function/component values (lucide-react icons
  // are functions), which is what a `LucideIcon`-typed prop here used to
  // be until it broke with "Functions cannot be passed directly to Client
  // Components".
  icon: ReactNode;
  // A count badge — shown in warning color while `attention` is true (there's
  // something here the viewer specifically needs to act on or hasn't seen
  // yet), otherwise in a neutral tone once there's just content to browse.
  // Omitted entirely when null.
  badge?: { count: number; attention: boolean } | null;
  content: ReactNode;
};

/**
 * Tabbed replacement for what used to be one long vertical stack of cards
 * on the document detail page (app/dashboard/documents/[id]/page.tsx) —
 * everything below the header/action row and status alerts (which stay
 * outside this, always visible) now lives in one of these zones instead of
 * competing for scroll position. Panels are toggled via CSS visibility, not
 * mount/unmount, so switching tabs never resets state inside a panel (e.g.
 * an in-progress inline comment draft).
 *
 * `tabs` is built server-side in page.tsx with the exact same per-section
 * conditionals the old flat layout used — this component only decides how
 * to group and switch between them, not who gets to see what.
 */
export default function DocumentDetailTabs({
  tabs,
  defaultTabKey,
}: {
  tabs: DetailTab[];
  // Which tab opens first, independent of tab button order (order is its
  // own separate design decision — see the comments in page.tsx on why
  // Review comes before Versions there). Falls back to the first tab when
  // the requested key isn't present for this document (e.g. an external-
  // link document has no Versions tab at all).
  defaultTabKey?: string;
}) {
  const [active, setActive] = useState(
    () => tabs.find((t) => t.key === defaultTabKey)?.key ?? tabs[0]?.key
  );

  // Panels toggle via CSS visibility (see the comment below), not mount/
  // unmount, and this component itself doesn't remount just because its
  // `tabs` prop changed shape — e.g. the "Waiting for review"/"Under
  // review" badge (app/dashboard/documents/[id]/page.tsx) links to this
  // same route with #review-status to jump straight to the Review tab,
  // but a hash-only navigation to a route already open doesn't remount
  // anything: `active` would otherwise stay stuck on whatever tab was
  // selected before (Feedback, say), so the Review tab never actually
  // shows despite the URL having changed. This catches that hash and
  // switches tabs for real, then scrolls to the target section once it's
  // actually visible — the browser's own native hash-scroll can't reach
  // it while it's still display:none from being the inactive panel.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#review-status") return;
    if (!tabs.some((t) => t.key === "review")) return;
    setActive("review");
    const frame = requestAnimationFrame(() => {
      document.getElementById("review-status")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tabs]);

  if (tabs.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      {/* overflow-x-auto with no overflow-y set makes the browser compute
          overflow-y as auto too (a real CSS Overflow Module behavior, not a
          Tailwind quirk) — the instant this row's own content is even a
          pixel taller than the row (an icon's line-height, a badge's
          padding), that gives it its own spurious vertical scrollbar.
          overflow-y-hidden pins it back to "never scrolls vertically,"
          leaving only the intended horizontal scroll-on-overflow. */}
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b-2 border-ff-border px-2">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`-mb-0.5 flex shrink-0 items-center gap-2 rounded-t-ff border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? "border-ff-accent bg-ff-lavender/50 text-ff-accent"
                  : "border-transparent text-ff-textMuted hover:border-transparent hover:bg-ff-lavender/30 hover:text-ff-accent"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge && tab.badge.count > 0 && (
                <Badge variant={tab.badge.attention ? "warning" : isActive ? "accent" : "neutral"}>
                  {tab.badge.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        // animate-fade-in (app/globals.css) restarts every time this goes
        // from display:none back to visible — switching to a tab replays
        // the same gentle fade/rise the rest of the app already uses,
        // rather than an instant snap.
        <div key={tab.key} className={tab.key === active ? "p-5 animate-fade-in" : "hidden"}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
