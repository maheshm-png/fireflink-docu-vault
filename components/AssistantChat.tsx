"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, FileText, Sparkles } from "lucide-react";
import BrandedLoader from "./BrandedLoader";

type Source = { id: string; title: string; categoryName: string; docType: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  isError?: boolean;
};

const SUGGESTIONS = [
  "What case studies do we have for the finance industry?",
  "Find me a competitor comparison against Salesforce.",
  "What's our most recent demo video?",
];

// sessionStorage (not localStorage) so a refresh keeps the conversation but
// it still clears when the tab/browser session actually ends — matches the
// "session only, no DB" scope this feature shipped with, it just also
// survives a refresh now instead of being wiped by every re-render.
const STORAGE_KEY = "ff-assistant-chat";

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Skips the persistence effect's very first run, which fires on mount
  // with the pre-hydration empty array — without this it would immediately
  // clobber whatever the hydration effect just read from storage.
  const isFirstPersistRun = useRef(true);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // corrupt/unavailable storage — just start with an empty conversation
    }
  }, []);

  useEffect(() => {
    if (isFirstPersistRun.current) {
      isFirstPersistRun.current = false;
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full/unavailable — conversation just won't survive a refresh
    }
  }, [messages]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Something went wrong.", isError: true },
        ]);
        return;
      }

      // No-match answers (and any other JSON reply) come back whole; a real
      // model answer comes back as a plain-text stream so it can render
      // token-by-token instead of sitting behind a 30-90s blocking wait.
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "assistant", content: data.answer, sources: data.sources }]);
        return;
      }

      const sourcesHeader = res.headers.get("x-assistant-sources");
      const sources: Source[] = sourcesHeader ? JSON.parse(decodeURIComponent(sourcesHeader)) : [];

      setMessages((prev) => [...prev, { role: "assistant", content: "", sources }]);
      setLoading(false);

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk };
          return next;
        });
        requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach the AI assistant — check your connection and try again.", isError: true },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="flex-1 overflow-y-auto px-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Sparkles className="h-8 w-8 text-ff-accent" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ff-text">Ask about anything in the Docu Vault</p>
              <p className="mt-1 text-xs text-ff-textMuted">
                I&apos;ll only answer from documents actually in the hub — if nothing matches, I&apos;ll say so.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-ff-border bg-white px-3.5 py-1.5 text-xs text-ff-textMuted transition-colors hover:border-ff-accent hover:text-ff-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {messages.map((m, i) => (
              <ChatBubble key={i} message={m} />
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-ff rounded-bl-sm border border-ff-border bg-white px-4 py-2.5 shadow-ff">
                  <BrandedLoader size={16} label="Thinking..." />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-center gap-2 border-t border-ff-border pt-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a document, topic, or client..."
          disabled={loading}
          className="w-full rounded-full border border-ff-border bg-ff-lavender/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-ff-accent focus:bg-white focus:shadow-ff-glow disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ff-accent-gradient text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div
          className={`whitespace-pre-wrap rounded-ff px-4 py-2.5 text-sm shadow-ff ${
            isUser
              ? "rounded-br-sm bg-ff-accent-gradient text-white"
              : message.isError
                ? "rounded-bl-sm border border-ff-danger/30 bg-ff-danger/10 text-ff-danger"
                : "rounded-bl-sm border border-ff-border bg-white text-ff-text"
          }`}
        >
          {message.content}
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.sources.map((s) => (
              <Link
                key={s.id}
                href={`/dashboard/documents/${s.id}`}
                className="flex items-center gap-1 rounded-full border border-ff-border bg-white px-2.5 py-1 text-xs text-ff-textMuted transition-colors hover:border-ff-accent hover:text-ff-text"
              >
                <FileText className="h-3 w-3 shrink-0" aria-hidden />
                <span className="max-w-[160px] truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
