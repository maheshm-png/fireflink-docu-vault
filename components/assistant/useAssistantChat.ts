"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Source = { id: string; title: string; categoryName: string; docType: string; team?: string };
export type Scope = { kind: "team"; teams: string[]; yourTeam: boolean };
export type Message = {
  role: "user" | "assistant";
  content: string;
  // Every document the answer was built from, known before it streams.
  sources?: Source[];
  // The ones the answer actually used (sent after it finishes). Only these
  // are shown, so an answer that found nothing doesn't list documents.
  usedSourceIds?: string[];
  scope?: Scope;
  notice?: string;
  // Follow-up questions to offer (built from the user's own documents).
  suggestions?: string[];
  isError?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  // Compacted summary of messages[0 .. compactedCount).
  summary?: string;
  compactedCount: number;
  compactions: number;
};

type Store = { activeId: string | null; conversations: Conversation[] };

// Matches META_SEPARATOR in lib/aiGuard.ts.
const META_SEPARATOR = "\u001e";
const MAX_CONVERSATIONS = 30;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Older turns are folded into a summary once the part still sent in full
// passes this size (roughly 3-4k tokens), keeping the last few turns as is.
const AUTO_COMPACT_CHARS = 12_000;
const KEEP_RECENT_MESSAGES = 4;

// Conversations are kept in this browser, separately for each user, so
// they're there next time (until deleted, or 30 days without use).
const storeKey = (userId: string) => `ff-docu-ai:v1:${userId}`;

function readStore(userId: string): Store {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    const parsed: Store = raw ? JSON.parse(raw) : { activeId: null, conversations: [] };
    const now = Date.now();
    parsed.conversations = (parsed.conversations ?? []).filter((c) => now - c.updatedAt < MAX_AGE_MS && c.messages?.length);
    if (parsed.activeId && !parsed.conversations.some((c) => c.id === parsed.activeId)) parsed.activeId = null;
    return parsed;
  } catch {
    return { activeId: null, conversations: [] };
  }
}

function writeStore(userId: string, store: Store) {
  try {
    const conversations = store.conversations
      .filter((c) => c.messages.length)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(storeKey(userId), JSON.stringify({ ...store, conversations }));
  } catch {
    // storage full/unavailable: the chat still works, it just isn't kept
  }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function visibleSources(m: Message): Source[] {
  if (!m.sources?.length) return [];
  if (!m.usedSourceIds) return m.sources;
  return m.sources.filter((s) => m.usedSourceIds!.includes(s.id));
}

const turnsOf = (messages: Message[]) =>
  messages.filter((m) => !m.isError && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));

export function useAssistantChat() {
  const [userId, setUserId] = useState<string | null>(null);
  const [starters, setStarters] = useState<string[]>([]);
  const [store, setStore] = useState<Store>({ activeId: null, conversations: [] });
  // "waiting" = request sent, nothing back yet; "streaming" = answer arriving.
  const [phase, setPhase] = useState<"idle" | "waiting" | "streaming">("idle");
  const [compacting, setCompacting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  // Who's asking (conversations are kept per user) and starter questions
  // built from documents they can see.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/assistant/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.userId) return;
        setUserId(data.userId);
        setStarters(Array.isArray(data.suggestions) ? data.suggestions : []);
        setStore(readStore(data.userId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (userId) writeStore(userId, store);
  }, [userId, store]);

  // Another tab (or the full page) changed the saved chats: pick that up
  // unless this view is mid-answer.
  useEffect(() => {
    if (!userId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === storeKey(userId) && !abortRef.current) setStore(readStore(userId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const active = useMemo(
    () => store.conversations.find((c) => c.id === store.activeId) ?? null,
    [store]
  );
  const messages = active?.messages ?? [];

  const updateActive = useCallback((id: string, patch: (c: Conversation) => Conversation) => {
    setStore((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === id ? { ...patch(c), updatedAt: Date.now() } : c)),
    }));
  }, []);

  const updateLastMessage = useCallback(
    (id: string, patch: (m: Message) => Message) =>
      updateActive(id, (c) => {
        const next = [...c.messages];
        next[next.length - 1] = patch(next[next.length - 1]);
        return { ...c, messages: next };
      }),
    [updateActive]
  );

  /** Folds older messages into the summary, keeping the last `keep` as they are. */
  const compactConversation = useCallback(
    async (id: string, keep: number): Promise<boolean> => {
      const conv = storeRef.current.conversations.find((c) => c.id === id);
      if (!conv) return false;
      const upTo = conv.messages.length - keep;
      if (upTo <= conv.compactedCount) return false;
      setCompacting(true);
      try {
        const res = await fetch("/api/assistant/compact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turns: turnsOf(conv.messages.slice(conv.compactedCount, upTo)), summary: conv.summary ?? "" }),
        });
        if (!res.ok) return false;
        const { summary } = await res.json();
        if (typeof summary !== "string" || !summary) return false;
        updateActive(id, (c) => ({ ...c, summary, compactedCount: upTo, compactions: c.compactions + 1 }));
        return true;
      } catch {
        return false;
      } finally {
        setCompacting(false);
      }
    },
    [updateActive]
  );

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || phase !== "idle" || compacting) return;

      // Start a conversation on the first question.
      let id = storeRef.current.activeId;
      if (!id || !storeRef.current.conversations.some((c) => c.id === id)) {
        id = newId();
        const conv: Conversation = {
          id,
          title: question.slice(0, 80),
          updatedAt: Date.now(),
          messages: [],
          compactedCount: 0,
          compactions: 0,
        };
        setStore((s) => ({ activeId: id, conversations: [conv, ...s.conversations] }));
        storeRef.current = { activeId: id, conversations: [conv, ...storeRef.current.conversations] };
      }
      const convId = id;

      // Long chat: fold the older part into the summary before asking.
      let conv = storeRef.current.conversations.find((c) => c.id === convId)!;
      const pendingChars = turnsOf(conv.messages.slice(conv.compactedCount)).reduce((n, t) => n + t.content.length, 0);
      if (pendingChars > AUTO_COMPACT_CHARS) {
        await compactConversation(convId, KEEP_RECENT_MESSAGES);
        conv = storeRef.current.conversations.find((c) => c.id === convId)!;
      }

      const recent = conv.messages.slice(conv.compactedCount);
      const history = turnsOf(recent);
      const lastAnswer = [...conv.messages].reverse().find((m) => m.role === "assistant" && !m.isError);
      const previousSourceIds = lastAnswer ? visibleSources(lastAnswer).map((s) => s.id) : [];

      updateActive(convId, (c) => {
        // A chat that opened with small talk ("hi") takes its title from
        // the first real question instead.
        const openedWithSmallTalk =
          c.messages.length === 2 && !c.messages[1].sources?.length && !!c.messages[1].suggestions?.length;
        return {
          ...c,
          title: openedWithSmallTalk ? question.slice(0, 80) : c.title,
          messages: [...c.messages, { role: "user", content: question }],
        };
      });
      setPhase("waiting");

      const controller = new AbortController();
      abortRef.current = controller;
      const addAnswer = (m: Message) => updateActive(convId, (c) => ({ ...c, messages: [...c.messages, m] }));

      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, history, previousSourceIds, summary: conv.summary ?? "" }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          addAnswer({ role: "assistant", content: data.error ?? "Something went wrong, please try again.", isError: true });
          return;
        }

        // Fixed answers (greetings, nothing found, a refusal) come back whole as JSON.
        if ((res.headers.get("content-type") ?? "").includes("application/json")) {
          const data = await res.json();
          addAnswer({
            role: "assistant",
            content: data.answer,
            sources: data.sources ?? [],
            scope: data.scope ?? undefined,
            suggestions: Array.isArray(data.suggestions) && data.suggestions.length ? data.suggestions : undefined,
          });
          return;
        }

        const decodeHeader = <T,>(name: string): T | undefined => {
          const v = res.headers.get(name);
          if (!v) return undefined;
          try {
            return JSON.parse(decodeURIComponent(v)) as T;
          } catch {
            return undefined;
          }
        };
        addAnswer({
          role: "assistant",
          content: "",
          sources: decodeHeader<Source[]>("x-assistant-sources") ?? [],
          scope: decodeHeader<Scope>("x-assistant-scope"),
        });
        setPhase("streaming");

        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          const cut = full.indexOf(META_SEPARATOR);
          const answer = cut >= 0 ? full.slice(0, cut) : full;
          updateLastMessage(convId, (m) => ({ ...m, content: answer }));
        }

        const cut = full.indexOf(META_SEPARATOR);
        if (cut >= 0) {
          try {
            const meta = JSON.parse(full.slice(cut + 1));
            updateLastMessage(convId, (m) =>
              meta.blocked
                ? { ...m, content: meta.notice, usedSourceIds: [], scope: undefined }
                : { ...m, usedSourceIds: meta.sources ?? [], notice: meta.notice }
            );
          } catch {
            // no usable metadata, keep the answer as it is
          }
        }
      } catch {
        if (controller.signal.aborted) {
          // Stopped by the user: keep whatever already arrived.
          updateActive(convId, (c) => {
            const last = c.messages[c.messages.length - 1];
            if (last?.role === "assistant" && !last.content) return { ...c, messages: c.messages.slice(0, -1) };
            if (last?.role === "assistant") return { ...c, messages: [...c.messages.slice(0, -1), { ...last, notice: "Stopped." }] };
            return c;
          });
          return;
        }
        updateActive(convId, (c) => {
          const last = c.messages[c.messages.length - 1];
          // The stream broke partway: keep the partial answer, add the error after it.
          const kept = last?.role === "assistant" && !last.content ? c.messages.slice(0, -1) : c.messages;
          return {
            ...c,
            messages: [...kept, { role: "assistant", content: "Couldn't reach Docu AI. Check your connection and try again.", isError: true }],
          };
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPhase("idle");
      }
    },
    [phase, compacting, compactConversation, updateActive, updateLastMessage]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Starts a fresh chat. The current one stays in Recent chats. */
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setStore((s) => ({ ...s, activeId: null }));
  }, []);

  const openConversation = useCallback((id: string) => {
    abortRef.current?.abort();
    setPhase("idle");
    setStore((s) => ({ ...s, activeId: id }));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    if (storeRef.current.activeId === id) abortRef.current?.abort();
    setStore((s) => ({
      activeId: s.activeId === id ? null : s.activeId,
      conversations: s.conversations.filter((c) => c.id !== id),
    }));
  }, []);

  /** Compact now (the Compact button): keeps only the last exchange as is. */
  const compact = useCallback(async () => {
    if (!active || phase !== "idle") return false;
    return compactConversation(active.id, 2);
  }, [active, phase, compactConversation]);

  const canCompact = !!active && active.messages.length - active.compactedCount > 4;
  // Past a couple of compactions (or a very long thread) answers get less
  // sharp; suggest starting fresh.
  const suggestNewChat = !!active && (active.compactions >= 2 || active.messages.length >= 40);

  return {
    ready: userId !== null,
    messages,
    active,
    conversations: store.conversations,
    starters,
    phase,
    compacting,
    canCompact,
    suggestNewChat,
    send,
    stop,
    newChat,
    openConversation,
    deleteConversation,
    compact,
  };
}
