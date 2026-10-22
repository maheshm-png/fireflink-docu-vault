"use client";

import { useState } from "react";
import ChatView from "./ChatView";
import ChatActions, { HistoryDrawer, RecentChats } from "./ChatActions";
import { useAssistantChat } from "./useAssistantChat";

/** Ask Docu AI as a full page (same saved conversations as the floating widget). */
export default function AssistantPageChat() {
  const chat = useAssistantChat();
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="relative flex min-h-0 flex-1">
      {/* Recent chats: always open on the left on wide screens, a slide-in drawer otherwise. */}
      <aside className="hidden w-72 shrink-0 border-r border-ff-border lg:block">
        <RecentChats chat={chat} />
      </aside>
      <div className="lg:hidden">
        <HistoryDrawer chat={chat} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-4 sm:px-5">
          <h1 className="min-w-0 truncate pr-3 text-base font-semibold text-ff-text">{chat.active?.title ?? "Ask Docu AI"}</h1>
          <ChatActions chat={chat} onHistory={() => setHistoryOpen((o) => !o)} historyOpen={historyOpen} historyClassName="lg:hidden" />
        </div>
        <div className="min-h-0 flex-1">
          <ChatView chat={chat} wide autoFocus />
        </div>
      </div>
    </div>
  );
}
