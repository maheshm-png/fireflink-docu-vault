"use client";

import { useEffect, useState } from "react";
import { Megaphone, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useNewDocuments } from "./NewDocumentsProvider";

type TickerItem =
  | { kind: "announcement"; id: string; text: string; author: string }
  | { kind: "new_document"; id: string; text: string };

// Announcements/new-doc entries don't need near-realtime freshness — a
// 15s interval here (times every open tab, times up to ~500 concurrent
// users) added meaningful sustained polling load for a ticker that's fine
// arriving a bit late.
const POLL_INTERVAL_MS = 45_000;
// How long each message stays on screen before advancing to the next one.
const ROTATE_INTERVAL_MS = 6_000;

/** Must render inside a NewDocumentsProvider (see app/dashboard/page.tsx and
 * app/dashboard/home/page.tsx) — that's where "new document" entries come
 * from now, not a prop, so they clear on their own once opened.
 *
 * A single-message slider (crossfade + dots + arrows) rather than a
 * continuously scrolling marquee — one message at a time reads as a normal
 * "what's new" bar instead of a ticker-tape effect, and stays legible
 * without anyone needing to chase text sliding past. */
export default function AnnouncementTicker() {
  const [announcements, setAnnouncements] = useState<
    { id: string; message: string; createdBy: { name: string } }[]
  >([]);
  const { recentDocs } = useNewDocuments();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

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
    ...recentDocs.map((d): TickerItem => ({ kind: "new_document", id: d.id, text: `"${d.title}" was just published, take a look` })),
  ];

  // The set of items can shrink between polls (an announcement expires, a
  // recent doc gets opened and drops off) — keeps the active index pointing
  // at something real instead of rendering nothing.
  useEffect(() => {
    if (index >= items.length && items.length > 0) setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [items.length, paused]);

  if (items.length === 0) return null;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="mb-4 flex items-center gap-3 rounded-ff border border-ff-accent/15 bg-gradient-to-r from-ff-lavender/60 via-white to-white px-3 py-2.5 shadow-ff"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ff-accent-gradient text-white shadow-ff">
        <Megaphone className="h-3.5 w-3.5" aria-hidden />
      </span>

      <div className="relative h-7 min-w-0 flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-500 ease-in-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {items.map((item, i) => (
            <div
              key={`${item.kind}-${item.id}`}
              aria-hidden={i !== index}
              className="flex h-full w-full shrink-0 items-center"
            >
              <TickerEntry item={item} />
            </div>
          ))}
        </div>
      </div>

      {items.length > 1 && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
            title="Previous"
            aria-label="Previous message"
            className="rounded-full p-1 text-ff-textMuted transition-colors hover:bg-white hover:text-ff-accent"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                title={`Message ${i + 1} of ${items.length}`}
                aria-label={`Show message ${i + 1} of ${items.length}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-ff-accent" : "w-1.5 bg-ff-border hover:bg-ff-accent/40"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % items.length)}
            title="Next"
            aria-label="Next message"
            className="rounded-full p-1 text-ff-textMuted transition-colors hover:bg-white hover:text-ff-accent"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
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
        className="group flex max-w-full min-w-0 items-center gap-2 rounded-full border border-ff-accent/20 bg-ff-accent/[0.06] py-1 pl-1 pr-3 text-sm text-ff-text transition-colors hover:bg-ff-accent/10"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ff-accent/15 text-ff-accent">
          <Sparkles className="h-3 w-3" aria-hidden />
        </span>
        <span className="truncate group-hover:underline">{item.text}</span>
      </Link>
    );
  }
  return (
    <span className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-ff-border bg-white py-1 pl-3 pr-1 text-sm text-ff-text shadow-sm">
      <span className="truncate">{item.text}</span>
      <AuthorBadge name={item.author} />
    </span>
  );
}
