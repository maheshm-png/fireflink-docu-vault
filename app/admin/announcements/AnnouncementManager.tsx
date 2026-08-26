"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pause, Play, Pencil } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import { formatDateTime } from "@/lib/formatDate";

type Announcement = {
  id: string;
  message: string;
  isActive: boolean;
  createdByName: string;
  createdAt: string;
};

const MAX_LEN = 300;

export default function AnnouncementManager({ initialAnnouncements }: { initialAnnouncements: Announcement[] }) {
  const router = useRouter();
  const [newMessage, setNewMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    setError(null);
    const res = await fetch("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newMessage }),
    });
    setPosting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not post this announcement — please try again.");
      return;
    }
    setNewMessage("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: editValue }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save changes — please try again.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function toggleHold(id: string, currentlyActive: boolean) {
    setBusyId(id);
    const res = await fetch(`/api/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !currentlyActive }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this announcement — please try again.");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/announcements/${id}`, { method: "DELETE" });
    setBusyId(null);
    setConfirmingDeleteId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not delete this announcement — please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={post} className="mb-6 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <label htmlFor="new-announcement" className="mb-1 block text-sm font-medium text-ff-text">
          Post a new message
        </label>
        <textarea
          id="new-announcement"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          maxLength={MAX_LEN}
          rows={2}
          placeholder="e.g. New Q3 competitor comparisons are up, check the Case Studies tab"
          className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-ff-textMuted">{newMessage.length}/{MAX_LEN}</span>
          <button
            type="submit"
            disabled={posting || !newMessage.trim()}
            className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-1.5 text-sm font-medium text-white shadow-ff transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {posting ? <BrandedLoader size={14} variant="white" /> : "Post"}
          </button>
        </div>
      </form>

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="space-y-2">
        {initialAnnouncements.length === 0 && (
          <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
            No announcements yet. Post one above and it will start scrolling on everyone&apos;s dashboard.
          </div>
        )}
        {initialAnnouncements.map((a) => (
          <div key={a.id} className="rounded-ff border border-ff-border bg-white p-3 shadow-ff">
            {editingId === a.id ? (
              <div>
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={MAX_LEN}
                  rows={2}
                  className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => saveEdit(a.id)}
                    disabled={busyId === a.id || !editValue.trim()}
                    className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {busyId === a.id ? <BrandedLoader size={12} variant="white" /> : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    disabled={busyId === a.id}
                    className="rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text hover:bg-ff-lavender"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`break-words text-sm ${a.isActive ? "text-ff-text" : "text-ff-textMuted line-through"}`}>
                    {a.message}
                  </p>
                  <p className="mt-1 text-xs text-ff-textMuted">
                    {a.createdByName} · {formatDateTime(a.createdAt)}
                    {!a.isActive && <span className="ml-1.5 text-ff-warning">· On hold</span>}
                  </p>
                </div>
                {confirmingDeleteId === a.id ? (
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <span className="text-ff-textMuted">Delete for good?</span>
                    <button
                      onClick={() => remove(a.id)}
                      disabled={busyId === a.id}
                      className="flex items-center justify-center rounded-ff bg-ff-danger px-2.5 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busyId === a.id ? <BrandedLoader size={12} variant="white" /> : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={busyId === a.id}
                      className="rounded-ff border border-ff-border px-2.5 py-1 text-ff-text hover:bg-ff-lavender"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(a.id);
                        setEditValue(a.message);
                      }}
                      disabled={busyId === a.id}
                      title="Edit"
                      aria-label="Edit"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text disabled:opacity-50"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => toggleHold(a.id, a.isActive)}
                      disabled={busyId === a.id}
                      title={a.isActive ? "Hold" : "Resume"}
                      aria-label={a.isActive ? "Hold" : "Resume"}
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text disabled:opacity-50"
                    >
                      {a.isActive ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(a.id)}
                      disabled={busyId === a.id}
                      title="Delete"
                      aria-label="Delete"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
