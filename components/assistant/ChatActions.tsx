"use client";

import { FoldVertical, History, MessageSquare, SquarePen, Trash2, X } from "lucide-react";
import type { useAssistantChat } from "./useAssistantChat";

type Chat = ReturnType<typeof useAssistantChat>;

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  active,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
        active ? "bg-ff-lavender text-ff-text" : "text-ff-textMuted hover:bg-ff-lavender hover:text-ff-text"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Header controls: Recent chats (opens the left sidebar), Compact and New
 * chat. `historyClassName` hides the history button where the sidebar is
 * already always open (wide layouts).
 */
export default function ChatActions({
  chat,
  onHistory,
  historyOpen,
  historyClassName = "",
}: {
  chat: Chat;
  onHistory: () => void;
  historyOpen: boolean;
  historyClassName?: string;
}) {
  const busy = chat.phase !== "idle" || chat.compacting;
  return (
    <div className="flex items-center gap-0.5">
      {chat.conversations.length > 0 && (
        <IconButton label="Recent chats" onClick={onHistory} active={historyOpen} className={historyClassName}>
          <History className="h-4 w-4" />
        </IconButton>
      )}
      {chat.canCompact && (
        <IconButton label="Compact: summarize earlier messages" onClick={() => chat.compact()} disabled={busy}>
          <FoldVertical className="h-4 w-4" />
        </IconButton>
      )}
      {chat.messages.length > 0 && (
        <IconButton label="New chat" onClick={chat.newChat}>
          <SquarePen className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}

/** The list of saved conversations, used in the left sidebar and the slide-in drawer. */
export function RecentChats({ chat, onPicked, onClose }: { chat: Chat; onPicked?: () => void; onClose?: () => void }) {
  const conversations = chat.conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button
          onClick={() => {
            chat.newChat();
            onPicked?.();
          }}
          className="flex flex-1 items-center gap-2 rounded-xl border border-ff-border px-3 py-2 text-sm font-medium text-ff-text transition-colors hover:border-ff-accent/50 hover:bg-ff-lavender"
        >
          <SquarePen className="h-4 w-4 text-ff-accent" aria-hidden />
          New chat
        </button>
        {onClose && (
          <IconButton label="Close recent chats" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ff-textMuted">Recent chats</p>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && <li className="px-2 py-3 text-xs text-ff-textMuted">Your chats will show up here.</li>}
        {conversations.map((c) => (
          <li key={c.id} className="group relative">
            <button
              onClick={() => {
                chat.openConversation(c.id);
                onPicked?.();
              }}
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors hover:bg-ff-lavender ${
                c.id === chat.active?.id ? "bg-ff-lavender" : ""
              }`}
            >
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ff-accent" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ff-text">{c.title}</span>
                <span className="block text-[11px] text-ff-textMuted">{timeAgo(c.updatedAt)}</span>
              </span>
            </button>
            <button
              onClick={() => chat.deleteConversation(c.id)}
              aria-label={`Delete chat: ${c.title}`}
              title="Delete chat"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ff-textMuted opacity-0 transition-opacity hover:bg-ff-danger/10 hover:text-ff-danger focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-ff-border/70 px-4 py-2 text-[11px] text-ff-textMuted">Saved in this browser for 30 days.</p>
    </div>
  );
}

/** Recent chats sliding in from the left over `children`'s container. */
export function HistoryDrawer({ chat, open, onClose, fixed = false }: { chat: Chat; open: boolean; onClose: () => void; fixed?: boolean }) {
  const pos = fixed ? "fixed" : "absolute";
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`${pos} inset-0 z-20 bg-ff-text/20 transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        aria-label="Recent chats"
        aria-hidden={!open}
        className={`${pos} inset-y-0 left-0 z-30 w-72 max-w-[85%] border-r border-ff-border shadow-ff-lg transition-all duration-200 ease-out ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <RecentChats chat={chat} onPicked={onClose} onClose={onClose} />
      </aside>
    </>
  );
}
