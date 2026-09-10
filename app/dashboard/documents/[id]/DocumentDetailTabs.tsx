"use client";

import { useState, type ReactNode } from "react";

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
export default function DocumentDetailTabs({ tabs }: { tabs: DetailTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);

  if (tabs.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      <div className="flex gap-1 overflow-x-auto border-b-2 border-ff-border px-2">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`-mb-0.5 flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? "border-ff-accent text-ff-accent"
                  : "border-transparent text-ff-textMuted hover:border-transparent hover:text-ff-accent"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge && tab.badge.count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    tab.badge.attention
                      ? "bg-ff-warning/15 text-ff-warning"
                      : isActive
                      ? "bg-ff-accent/15 text-ff-accent"
                      : "bg-ff-lavender text-ff-textMuted"
                  }`}
                >
                  {tab.badge.count}
                </span>
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
