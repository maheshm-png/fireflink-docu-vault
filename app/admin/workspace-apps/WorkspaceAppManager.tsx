"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import ConfirmModal from "@/components/ConfirmModal";
import { WORKSPACE_ICONS, WORKSPACE_ICON_KEYS, DEFAULT_WORKSPACE_ICON } from "@/lib/workspaceIcons";

type WorkspaceAppRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  href: string | null;
  icon: string;
  sortOrder: number;
};

type FormState = { name: string; category: string; description: string; href: string; icon: string };

const EMPTY_FORM: FormState = { name: "", category: "", description: "", href: "", icon: DEFAULT_WORKSPACE_ICON };

export default function WorkspaceAppManager({ initialApps }: { initialApps: WorkspaceAppRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    const res = await fetch("/api/admin/workspace-apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setAdding(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not add this app, please try again.");
      return;
    }
    setForm(EMPTY_FORM);
    router.refresh();
  }

  function startEdit(a: WorkspaceAppRow) {
    setEditingId(a.id);
    setEditForm({ name: a.name, category: a.category, description: a.description, href: a.href ?? "", icon: a.icon });
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim() || !editForm.category.trim() || !editForm.description.trim()) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/workspace-apps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save this app, please try again.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/workspace-apps/${id}`, { method: "DELETE" });
    setBusyId(null);
    setConfirmingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not remove this app, please try again.");
      return;
    }
    router.refresh();
  }

  // Swaps this row's sortOrder with its neighbor's — the simplest possible
  // reorder that still gives every row a stable, distinct order, without a
  // drag-and-drop library for what's normally a handful of tiles.
  async function move(index: number, direction: -1 | 1) {
    const target = initialApps[index + direction];
    const current = initialApps[index];
    if (!target) return;
    setBusyId(current.id);
    setError(null);
    const [resA, resB] = await Promise.all([
      fetch(`/api/admin/workspace-apps/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: target.sortOrder }),
      }),
      fetch(`/api/admin/workspace-apps/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ]);
    setBusyId(null);
    if (!resA.ok || !resB.ok) {
      setError("Could not reorder, please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="mb-6 space-y-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <p className="text-xs font-semibold uppercase tracking-wide text-ff-textMuted">Add a new app</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Firetracker"
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">Category</label>
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. CRM"
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="One short line shown on the tile"
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">
              Link <span className="text-ff-textMuted">(leave blank for Coming Soon)</span>
            </label>
            <input
              value={form.href}
              onChange={(e) => setForm((f) => ({ ...f, href: e.target.value }))}
              placeholder="https://..."
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">Icon</label>
            <select
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              className="rounded-ff border border-ff-border px-3 py-2 text-sm"
            >
              {WORKSPACE_ICON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={adding || !form.name.trim() || !form.category.trim() || !form.description.trim()}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-50"
        >
          {adding ? <BrandedLoader size={14} variant="white" /> : "Add App"}
        </button>
      </form>

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="space-y-2">
        {initialApps.length === 0 && (
          <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
            No assets yet. Add one above so it shows up on the Presales Team Assets page.
          </div>
        )}
        {initialApps.map((a, i) => {
          const Icon = WORKSPACE_ICONS[a.icon] ?? WORKSPACE_ICONS[DEFAULT_WORKSPACE_ICON];
          const busy = busyId === a.id;
          return (
            <div key={a.id} className="rounded-ff border border-ff-border bg-white p-3 shadow-ff">
              {editingId === a.id ? (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Name"
                      className="rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                    />
                    <input
                      value={editForm.category}
                      onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      placeholder="Category"
                      className="rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                    />
                  </div>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Description"
                    className="w-full rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      value={editForm.href}
                      onChange={(e) => setEditForm((f) => ({ ...f, href: e.target.value }))}
                      placeholder="https:// (blank = Coming Soon)"
                      className="rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                    />
                    <select
                      value={editForm.icon}
                      onChange={(e) => setEditForm((f) => ({ ...f, icon: e.target.value }))}
                      className="rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                    >
                      {WORKSPACE_ICON_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(a.id)}
                      disabled={busy}
                      className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      {busy ? <BrandedLoader size={12} variant="white" /> : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      className="rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text hover:bg-ff-lavender"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent-gradient text-white">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-ff-text">{a.name}</span>
                      <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-[10px] font-medium text-ff-accent">
                        {a.category}
                      </span>
                      {!a.href && (
                        <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ff-textMuted">
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ff-textMuted">{a.description}</p>
                    {a.href && <p className="mt-0.5 truncate text-xs text-ff-accent">{a.href}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || busy}
                      title="Move up"
                      aria-label="Move up"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === initialApps.length - 1 || busy}
                      title="Move down"
                      aria-label="Move down"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => startEdit(a)}
                      title="Edit"
                      aria-label="Edit"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => setConfirmingId(a.id)}
                      title="Delete"
                      aria-label="Delete"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={confirmingId !== null}
        title="Remove this asset from Presales Team Assets?"
        message="This can't be undone."
        confirmLabel="Yes, remove"
        danger
        busy={busyId === confirmingId}
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
