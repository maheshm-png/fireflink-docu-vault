"use client";

import { createContext, useContext, useEffect, useState } from "react";

type NewDocumentsState = {
  documentIds: Set<string>;
  categoryIds: Set<string>;
  recentDocs: { id: string; title: string }[];
};

const EMPTY_STATE: NewDocumentsState = { documentIds: new Set(), categoryIds: new Set(), recentDocs: [] };

const NewDocumentsContext = createContext<NewDocumentsState | null>(null);

const POLL_INTERVAL_MS = 15_000;

/**
 * Wraps a dashboard page's content so the ticker's "new document" entries
 * and the NewBadge on document rows/tiles all read from one shared,
 * self-refreshing source (/api/notifications/new-documents) instead of a
 * static server-rendered prop. Fixes the "still shows as new until I
 * refresh" problem: opening a document marks its notification read
 * server-side, but a component that only received that data as a one-time
 * prop has no way to find out — this polls (plus an immediate re-check on
 * tab focus/visibility, for "opened it in another tab" without waiting out
 * the interval) so every consumer catches up on its own.
 *
 * Seeded with the server's own initial computation (`initial*`) so the
 * first paint is already correct — polling only refines it from there,
 * never starts from a blank/wrong state.
 */
export function NewDocumentsProvider({
  initialDocumentIds = [],
  initialCategoryIds = [],
  initialRecentDocs = [],
  children,
}: {
  initialDocumentIds?: string[];
  initialCategoryIds?: string[];
  initialRecentDocs?: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  const [state, setState] = useState<NewDocumentsState>({
    documentIds: new Set(initialDocumentIds),
    categoryIds: new Set(initialCategoryIds),
    recentDocs: initialRecentDocs,
  });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/notifications/new-documents");
        if (!res.ok || cancelled) return;
        const data: { documentIds: string[]; categoryIds: string[]; recentDocs: { id: string; title: string }[] } =
          await res.json();
        if (cancelled) return;
        setState({
          documentIds: new Set(data.documentIds),
          categoryIds: new Set(data.categoryIds),
          recentDocs: data.recentDocs,
        });
      } catch {
        // Transient network hiccup — the next interval tick (or focus
        // event) retries; no need to surface this to the user.
      }
    }

    poll(); // immediate check on mount — e.g. navigating back after opening a doc
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

  return <NewDocumentsContext.Provider value={state}>{children}</NewDocumentsContext.Provider>;
}

export function useNewDocuments(): NewDocumentsState {
  return useContext(NewDocumentsContext) ?? EMPTY_STATE;
}
