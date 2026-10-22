"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  FileVideo,
  FoldVertical,
  Info,
  Link2,
  Presentation,
  Sheet,
  Sparkles,
  Square,
  Users,
} from "lucide-react";
import { visibleSources, type Message, type Source, type useAssistantChat } from "./useAssistantChat";

type Chat = ReturnType<typeof useAssistantChat>;

/**
 * The conversation and the message box. Fills its container, so the same
 * view works in the floating panel, in full screen and on the page.
 * `wide` gives messages a centered reading column for the larger layouts.
 */
export default function ChatView({ chat, wide = false, autoFocus = false }: { chat: Chat; wide?: boolean; autoFocus?: boolean }) {
  const { messages, phase, send, stop, starters, active, compacting, suggestNewChat, newChat } = chat;
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Only auto-scroll while the reader is already at the bottom, so scrolling
  // up to re-read isn't yanked back down by every new token.
  const stickToBottom = useRef(true);
  const busy = phase !== "idle" || compacting;
  const compactedCount = active?.compactedCount ?? 0;
  const column = wide ? "mx-auto w-full max-w-3xl" : "w-full";

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus({ preventScroll: true });
  }, [busy]);

  function autoSize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function submit(text: string) {
    if (!text.trim() || busy) return;
    stickToBottom.current = true;
    send(text);
    setInput("");
    requestAnimationFrame(autoSize);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5"
      >
        {messages.length === 0 ? (
          <div className={`${column} flex h-full flex-col items-center justify-center gap-4 py-8 text-center`}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ff-plum-gradient text-white shadow-ff-md">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-lg font-semibold text-ff-text">How can I help?</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ff-textMuted">
                Ask about any document you have access to. I&apos;ll answer from them and link the sources.
              </p>
            </div>
            {starters.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {starters.map((s) => (
                  <SuggestionChip key={s} text={s} onPick={submit} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`${column} flex flex-col gap-6 py-5`}>
            {messages.map((m, i) => (
              <Fragment key={i}>
                {i === compactedCount && compactedCount > 0 && <CompactedDivider />}
                <MessageRow
                  message={m}
                  streaming={phase === "streaming" && i === messages.length - 1}
                  onPick={i === messages.length - 1 ? submit : undefined}
                />
              </Fragment>
            ))}
            {compactedCount > 0 && compactedCount >= messages.length && <CompactedDivider />}
            {compacting && (
              <div className="flex items-center justify-center gap-2 text-xs text-ff-textMuted">
                <FoldVertical className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                Summarizing earlier messages to keep this chat fast
              </div>
            )}
            {phase === "waiting" && <Thinking />}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-3 pt-2 sm:px-5">
        {suggestNewChat && !busy && (
          <div className={`${column} mb-2 flex items-center justify-between gap-3 rounded-xl bg-ff-lavender px-3 py-2 text-xs text-ff-text`}>
            <span>This chat is getting long. A new chat gives sharper answers.</span>
            <button onClick={newChat} className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-medium text-ff-accent shadow-ff hover:bg-ff-lavenderDeep">
              New chat
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className={`${column} flex items-end gap-2 rounded-2xl border border-ff-border bg-white py-1.5 pl-4 pr-1.5 shadow-ff transition-all focus-within:border-ff-accent/60 focus-within:shadow-ff-glow`}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={2000}
            onChange={(e) => {
              setInput(e.target.value);
              autoSize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Ask about a document, client or topic"
            aria-label="Your question"
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm text-ff-text outline-none placeholder:text-ff-textMuted/80 focus:outline-none focus:ring-0"
            style={{ boxShadow: "none" }}
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop answering"
              title="Stop"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ff-text text-white transition-opacity hover:opacity-85"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              title="Send"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ff-accent text-white transition-all hover:bg-ff-accentHover disabled:bg-ff-lavenderDeep disabled:text-ff-textMuted/60"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </form>
        <p className={`${column} mt-1.5 text-center text-[11px] text-ff-textMuted/80`}>
          Docu AI answers only from documents you can access. Check important details in the source.
        </p>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ff-plum-gradient text-white">
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-3">
      <Avatar />
      <div className="flex items-center gap-2 text-sm text-ff-textMuted">
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ff-accent/70" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
        Searching your documents
      </div>
    </div>
  );
}

function SuggestionChip({ text, onPick }: { text: string; onPick: (t: string) => void }) {
  return (
    <button
      onClick={() => onPick(text)}
      className="max-w-full truncate rounded-full border border-ff-border bg-white px-3.5 py-1.5 text-left text-[13px] text-ff-text transition-colors hover:border-ff-accent/50 hover:bg-ff-lavender"
    >
      {text}
    </button>
  );
}

function CompactedDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-ff-textMuted">
      <span className="h-px flex-1 bg-ff-border" />
      <span className="flex items-center gap-1">
        <FoldVertical className="h-3 w-3" aria-hidden />
        Earlier messages summarized
      </span>
      <span className="h-px flex-1 bg-ff-border" />
    </div>
  );
}

function MessageRow({ message, streaming, onPick }: { message: Message; streaming: boolean; onPick?: (t: string) => void }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ff-lavender px-4 py-2.5 text-sm text-ff-text">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.isError) {
    return (
      <div className="flex gap-3">
        <Avatar />
        <div className="rounded-xl border border-ff-danger/20 bg-ff-danger/5 px-3.5 py-2 text-sm text-ff-danger">{message.content}</div>
      </div>
    );
  }

  const sources = streaming ? [] : visibleSources(message);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content.replace(/\*\*/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked, nothing useful to do
    }
  }

  return (
    <div className="group flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        {message.scope?.kind === "team" && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-ff-lavender px-2.5 py-1 text-xs font-medium text-ff-accent">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {message.scope.yourTeam ? "Found in your team's documents" : "Found in team documents you can access"}
            {message.scope.teams.length > 0 && <span className="font-normal text-ff-textMuted">· {message.scope.teams.join(", ")}</span>}
          </div>
        )}

        <div className="break-words text-sm leading-6 text-ff-text">
          <FormattedText text={message.content} />
          {streaming && <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-sm bg-ff-accent align-[-3px]" />}
        </div>

        {message.notice && !streaming && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ff-textMuted">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {message.notice}
          </p>
        )}

        {sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <SourceChip key={s.id} source={s} />
            ))}
          </div>
        )}

        {onPick && message.suggestions && message.suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.suggestions.map((s) => (
              <SuggestionChip key={s} text={s} onPick={onPick} />
            ))}
          </div>
        )}

        {!streaming && message.content && (
          <button
            onClick={copy}
            className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ff-textMuted opacity-0 transition-opacity hover:bg-ff-lavender hover:text-ff-text focus:opacity-100 group-hover:opacity-100"
          >
            {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceChip({ source }: { source: Source }) {
  const Icon =
    source.docType === "video"
      ? FileVideo
      : source.docType === "ppt"
        ? Presentation
        : source.docType === "excel"
          ? Sheet
          : source.docType === "link"
            ? Link2
            : FileText;
  return (
    <Link
      href={`/dashboard/documents/${source.id}`}
      title={`${source.title} · ${source.categoryName}${source.team ? ` · Team: ${source.team}` : ""}`}
      className="flex max-w-full items-center gap-1.5 rounded-lg border border-ff-border bg-white px-2.5 py-1.5 text-xs text-ff-text transition-colors hover:border-ff-accent/50 hover:bg-ff-lavender"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-ff-accent" aria-hidden />
      <span className="max-w-[200px] truncate">{source.title}</span>
      {source.team && (
        <span className="shrink-0 rounded bg-ff-lavender px-1.5 py-px text-[10px] font-medium text-ff-accent">{source.team}</span>
      )}
    </Link>
  );
}

// Light formatting for model answers: paragraphs, "- " / "1. " lists and
// **bold**. Anything else is shown as plain text (never as HTML).
function FormattedText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i} className="pl-1">{inline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} start={list.start} className="my-2 list-decimal space-y-1.5 pl-5 marker:text-ff-textMuted">{items}</ol>
      ) : (
        <ul key={blocks.length} className="my-2 list-disc space-y-1.5 pl-5 marker:text-ff-accent/60">{items}</ul>
      )
    );
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      // Keep the model's own numbering when bullets split a numbered list.
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
      continue;
    }
    flushList();
    if (!line) continue;
    // Strip markdown heading markers the prompt asks the model not to use.
    blocks.push(
      <p key={blocks.length} className="my-2 first:mt-0 last:mb-0">
        {inline(line.replace(/^#{1,6}\s+/, ""))}
      </p>
    );
  }
  flushList();

  return <>{blocks}</>;
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}
