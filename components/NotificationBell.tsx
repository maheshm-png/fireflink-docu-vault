"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X, CheckCheck, BellRing, BellOff, FileCheck, Undo2, FilePlus } from "lucide-react";
import { formatDateTime } from "@/lib/formatDate";

type NotificationItem = {
  id: string;
  type: "published" | "revoked" | "new_version";
  title: string;
  body: string | null;
  documentId: string | null;
  read: boolean;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30_000;
const DESKTOP_OPT_IN_KEY = "ff-desktop-notifications";

const TYPE_ICON: Record<NotificationItem["type"], typeof FileCheck> = {
  published: FileCheck,
  revoked: Undo2,
  new_version: FilePlus,
};

export default function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const seenIds = useRef<Set<string> | null>(null); // null until first fetch establishes a baseline

  useEffect(() => {
    setDesktopEnabled(typeof window !== "undefined" && localStorage.getItem(DESKTOP_OPT_IN_KEY) === "true");
  }, []);

  const poll = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const data: { notifications: NotificationItem[]; unreadCount: number } = await res.json();

    if (seenIds.current === null) {
      // First load — this is the baseline, not "new" activity, so no blink
      // or desktop popups for whatever already existed before this session.
      seenIds.current = new Set(data.notifications.map((n) => n.id));
    } else {
      const freshlyArrived = data.notifications.filter((n) => !seenIds.current!.has(n.id));
      if (freshlyArrived.length > 0) {
        for (const n of freshlyArrived) seenIds.current.add(n.id);
        setBlinking(true);
        if (desktopEnabled && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          for (const n of freshlyArrived.slice(0, 3)) {
            new Notification(n.title, { body: n.body ?? undefined, tag: n.id });
          }
        }
      }
    }

    setItems(data.notifications);
    setUnreadCount(data.unreadCount);
  }, [desktopEnabled]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    if (open) setBlinking(false);
  }, [open]);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function toggleDesktop() {
    if (!desktopEnabled) {
      if (typeof window !== "undefined" && "Notification" in window) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
      }
      localStorage.setItem(DESKTOP_OPT_IN_KEY, "true");
      setDesktopEnabled(true);
    } else {
      localStorage.setItem(DESKTOP_OPT_IN_KEY, "false");
      setDesktopEnabled(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        title="Notifications"
        className={`relative rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white ${
          collapsed ? "" : ""
        }`}
      >
        <Bell className={`h-4 w-4 ${blinking ? "animate-bell-blink" : ""}`} />
        {unreadCount > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ff-danger px-1 text-[10px] font-medium text-white ${
              blinking ? "animate-bell-blink" : ""
            }`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="flex h-full w-full max-w-sm flex-col bg-white shadow-ff-lg animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ff-border px-4 py-3">
              <h2 className="text-base font-bold text-ff-text">Notifications</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleDesktop}
                  title={desktopEnabled ? "Turn off desktop notifications" : "Turn on desktop notifications"}
                  aria-label={desktopEnabled ? "Turn off desktop notifications" : "Turn on desktop notifications"}
                  className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                >
                  {desktopEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                </button>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    title="Mark all as read"
                    aria-label="Mark all as read"
                    className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                  >
                    <CheckCheck className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <Bell className="h-8 w-8 text-ff-textMuted" aria-hidden />
                  <p className="text-sm text-ff-textMuted">No notifications yet.</p>
                </div>
              ) : (
                <ul>
                  {items.map((n) => {
                    const Icon = TYPE_ICON[n.type];
                    const content = (
                      <div
                        className={`flex gap-3 border-b border-ff-border px-4 py-3 transition-colors hover:bg-ff-lavender/50 ${
                          !n.read ? "bg-ff-accent/5" : ""
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            n.type === "revoked" ? "bg-ff-danger/15 text-ff-danger" : "bg-ff-accent/15 text-ff-accent"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ff-text">{n.title}</p>
                          {n.body && <p className="mt-0.5 text-xs text-ff-textMuted">{n.body}</p>}
                          <p className="mt-1 text-xs text-ff-textMuted">{formatDateTime(n.createdAt)}</p>
                        </div>
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ff-accent" aria-hidden />}
                      </div>
                    );
                    return (
                      <li key={n.id}>
                        {n.documentId ? (
                          <Link href={`/dashboard/documents/${n.documentId}`} onClick={() => { if (!n.read) markRead(n.id); setOpen(false); }}>
                            {content}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => !n.read && markRead(n.id)} className="block w-full text-left">
                            {content}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
