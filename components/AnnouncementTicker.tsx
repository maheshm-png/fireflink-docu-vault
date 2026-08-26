"use client";

import { useEffect, useState } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useNewDocuments } from "./NewDocumentsProvider";

type TickerItem =
  | { kind: "announcement"; id: string; text: string; author: string }
  | { kind: "new_document"; id: string; text: string };

const POLL_INTERVAL_MS = 15_000;

/** Must render inside a NewDocumentsProvider (see app/dashboard/page.tsx and
 * app/dashboard/home/page.tsx) — that's where "new document" entries come
 * from now, not a prop, so they clear on their own once opened. */
export default function AnnouncementTicker() {
  const [announcements, setAnnouncements] = useState<
    { id: string; message: string; createdBy: { name: string } }[]
  >([]);
  const { recentDocs } = useNewDocuments();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/announcements");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setAnnouncements(data);
      } catch {
        // transient — next interval tick (or focus) retries
      }
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", poll);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", poll);
    };
  }, []);

  const items: TickerItem[] = [
    ...announcements.map((a): TickerItem => ({ kind: "announcement", id: a.id, text: a.message, author: a.createdBy.name })),
    ...recentDocs.map((d): TickerItem => ({ kind: "new_document", id: d.id, text: `"${d.title}" was just published — take a look` })),
  ];

  if (items.length === 0) return null;

  // Rendered twice back to back so the CSS animation can scroll exactly one
  // copy's width and loop seamlessly, instead of snapping back to start.
  const track = [...items, ...items];

  return (
    <div className="mb-4 flex items-center gap-3 overflow-hidden rounded-ff border border-ff-accent/15 bg-gradient-to-r from-ff-lavender/60 via-white to-white px-3 py-2.5 shadow-ff">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ff-accent-gradient text-white shadow-ff">
        <Megaphone className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="ticker-viewport flex-1 overflow-hidden">
        <div className="ticker-track flex w-max items-center gap-3">
          {track.map((item, i) => (
            <TickerEntry key={`${item.kind}-${item.id}-${i}`} item={item} />
          ))}
        </div>
      </div>
      <style>{`
        .ticker-track {
          animation: ff-ticker-scroll linear infinite;
          animation-duration: ${Math.max(20, items.length * 8)}s;
        }
        .ticker-viewport:hover .ticker-track { animation-play-state: paused; }
        @keyframes ff-ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ticker-track { animation: none; }
        }
      `}</style>
    </div>
  );
}

function AuthorBadge({ name }: { name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/70 py-0.5 pl-0.5 pr-2 text-xs font-medium text-ff-accent">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ff-accent text-[9px] font-semibold uppercase text-white">
        {name.charAt(0)}
      </span>
      {name}
    </span>
  );
}

function TickerEntry({ item }: { item: TickerItem }) {
  if (item.kind === "new_document") {
    return (
      <Link
        href={`/dashboard/documents/${item.id}`}
        className="group flex shrink-0 items-center gap-2 rounded-full border border-ff-accent/20 bg-ff-accent/[0.06] py-1 pl-1 pr-3 text-sm text-ff-text transition-colors hover:bg-ff-accent/10"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ff-accent/15 text-ff-accent">
          <Sparkles className="h-3 w-3" aria-hidden />
        </span>
        <span className="group-hover:underline">{item.text}</span>
      </Link>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-ff-border bg-white py-1 pl-3 pr-1 text-sm text-ff-text shadow-sm">
      {item.text}
      <AuthorBadge name={item.author} />
    </span>
  );
}
