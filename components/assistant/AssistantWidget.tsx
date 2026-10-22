"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Maximize2, Minimize2, Minus, Sparkles } from "lucide-react";
import ChatView from "./ChatView";
import ChatActions, { HistoryDrawer, IconButton, RecentChats } from "./ChatActions";
import { useAssistantChat } from "./useAssistantChat";

type Mode = "closed" | "panel" | "full";
// Where the launcher sits: which side, and how far up from the bottom.
type Spot = { side: "left" | "right"; bottom: number };

const MODE_KEY = "ff-assistant-mode";
const SPOT_KEY = "ff-assistant-launcher";
const DEFAULT_SPOT: Spot = { side: "right", bottom: 24 };
const LAUNCHER = 52; // px
const EDGE = 20; // px from the screen edge

// Pages the floating assistant appears on. It lives in the root layout so a
// conversation (and an answer still streaming) survives moving between
// pages; the Ask Docu AI page has the chat built in, so it hides there.
function showsOn(path: string | null): boolean {
  if (!path) return false;
  if (path.startsWith("/dashboard/assistant")) return false;
  return path.startsWith("/dashboard") || path.startsWith("/admin");
}

/** Floating Ask Docu AI: a draggable AI button that opens a chat panel, which can expand to full screen. */
export default function AssistantWidget() {
  // Mounted only where it shows, so on the Ask Docu AI page there's just
  // one copy of the conversation (the page's).
  return showsOn(usePathname()) ? <Widget /> : null;
}

function Widget() {
  const chat = useAssistantChat();
  const [mode, setMode] = useState<Mode>("closed");
  const [spot, setSpot] = useState<Spot>(DEFAULT_SPOT);
  const [historyOpen, setHistoryOpen] = useState(false);
  const busy = chat.phase !== "idle";

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(MODE_KEY) as Mode | null;
      if (saved === "panel" || saved === "full") setMode(saved);
      const s = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "null");
      if (s && (s.side === "left" || s.side === "right") && typeof s.bottom === "number") setSpot(s);
    } catch {
      // storage unavailable: defaults
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(MODE_KEY, mode);
    } catch {
      // storage unavailable, mode just won't survive a refresh
    }
  }, [mode]);

  // Esc steps back: full screen to panel, panel to closed.
  useEffect(() => {
    if (mode === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode((m) => (m === "full" ? "panel" : "closed"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // No page scrolling behind the full-screen chat.
  useEffect(() => {
    if (mode !== "full") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mode]);

  if (mode === "closed") {
    return <Launcher spot={spot} onMove={setSpot} onOpen={() => setMode("panel")} busy={busy} />;
  }

  const full = mode === "full";
  // The panel opens on the side the launcher was moved to, so it covers
  // the same corner the user chose to keep free of content.
  const side = spot.side === "left" ? "sm:left-5" : "sm:right-5";

  return (
    <div
      role="dialog"
      aria-label="Ask Docu AI"
      className={
        full
          ? "fixed inset-0 z-[70] flex flex-col bg-[#FBF8FA] animate-fade-in"
          : `fixed inset-0 z-[70] flex flex-col bg-white animate-fade-in sm:inset-auto sm:bottom-5 ${side} sm:h-[640px] sm:max-h-[calc(100vh-2.5rem)] sm:w-[420px] sm:rounded-2xl sm:border sm:border-ff-border sm:shadow-[0_24px_60px_rgba(43,32,51,0.22),0_4px_14px_rgba(43,32,51,0.08)]`
      }
    >
      <header className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-ff-border/70 bg-white px-4 py-3 sm:px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ff-plum-gradient text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-ff-text">{chat.active?.title ?? "Docu AI"}</p>
          <p className="truncate text-xs text-ff-textMuted">Answers from documents you can access</p>
        </div>
        <div className="flex items-center gap-0.5">
          <ChatActions
            chat={chat}
            onHistory={() => setHistoryOpen((o) => !o)}
            historyOpen={historyOpen}
            historyClassName={full ? "lg:hidden" : ""}
          />
          <IconButton label={full ? "Exit full screen" : "Full screen"} onClick={() => setMode(full ? "panel" : "full")} className="hidden sm:flex">
            {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </IconButton>
          <IconButton label="Minimize" onClick={() => setMode("closed")}>
            <Minus className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden sm:rounded-b-2xl">
        {/* Recent chats: a fixed left sidebar in full screen on wide
            screens, otherwise a drawer sliding in from the left. */}
        {full && (
          <aside className="hidden w-72 shrink-0 border-r border-ff-border lg:block">
            <RecentChats chat={chat} />
          </aside>
        )}
        <div className={full ? "lg:hidden" : ""}>
          <HistoryDrawer chat={chat} open={historyOpen} onClose={() => setHistoryOpen(false)} />
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <ChatView chat={chat} wide={full} autoFocus />
        </div>
      </div>
    </div>
  );
}

/**
 * The round AI button. Drag it anywhere: on release it snaps to the nearer
 * side and keeps its height, so it can be moved off whatever it covers.
 * It sits below dialogs and previews (z-40) rather than on top of them.
 */
function Launcher({
  spot,
  onMove,
  onOpen,
  busy,
}: {
  spot: Spot;
  onMove: (s: Spot) => void;
  onOpen: () => void;
  busy: boolean;
}) {
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);

  const clampBottom = (b: number) => Math.min(Math.max(b, 12), window.innerHeight - LAUNCHER - 12);

  const style: React.CSSProperties = live
    ? { left: live.x - LAUNCHER / 2, top: live.y - LAUNCHER / 2 }
    : { [spot.side]: EDGE, bottom: spot.bottom };

  return (
    <button
      aria-label="Open Ask Docu AI"
      title="Ask Docu AI (drag to move)"
      style={{ ...style, width: LAUNCHER, height: LAUNCHER, touchAction: "none" }}
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
        d.moved = true;
        setLive({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d?.moved) return onOpen();
        const next: Spot = {
          side: e.clientX < window.innerWidth / 2 ? "left" : "right",
          bottom: clampBottom(window.innerHeight - e.clientY - LAUNCHER / 2),
        };
        setLive(null);
        onMove(next);
        try {
          localStorage.setItem(SPOT_KEY, JSON.stringify(next));
        } catch {
          // storage unavailable: position just isn't remembered
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group fixed z-40 flex select-none items-center justify-center rounded-full bg-ff-plum-gradient text-white shadow-ff-lg ring-4 ring-white/70 transition-shadow hover:shadow-[0_18px_40px_rgba(43,32,51,0.32)] ${
        live ? "cursor-grabbing" : "cursor-pointer animate-fade-in"
      }`}
    >
      <Sparkles className="h-6 w-6 transition-transform group-hover:scale-110" aria-hidden />
      <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 rounded-full bg-white px-1 text-[9px] font-bold leading-4 text-ff-accent shadow-ff">
        AI
      </span>
      {busy && <span className="absolute -left-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-emerald-400 ring-2 ring-white" />}
    </button>
  );
}
