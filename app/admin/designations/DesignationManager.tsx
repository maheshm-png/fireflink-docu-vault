"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Pencil } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

type Designation = { id: string; name: string; userCount: number };

export default function DesignationManager({ initialDesignations }: { initialDesignations: Designation[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    const res = await fetch("/api/admin/designations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setAdding(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not add this designation — please try again.");
      return;
    }
    setName("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/designations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editValue }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not rename this designation — please try again.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/designations/${id}`, { method: "DELETE" });
    setBusyId(null);
    setConfirmingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not delete this designation — please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="mb-6 flex items-end gap-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <div className="flex-1">
          <label htmlFor="new-designation" className="mb-1 block text-xs text-ff-textMuted">
            New designation
          </label>
          <input
            id="new-designation"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Presales Consultant"
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={adding || !name.trim()}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-50"
        >
          {adding ? <BrandedLoader size={14} variant="white" /> : "Add"}
        </button>
      </form>

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="space-y-2">
        {initialDesignations.length === 0 && (
          <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
            No designations yet. Add one above so it shows up on user profiles.
          </div>
        )}
        {initialDesignations.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-ff border border-ff-border bg-white p-3 shadow-ff">
            {editingId === d.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                  className="flex-1 rounded-ff border border-ff-border px-2 py-1 text-sm"
                />
                <button
                  onClick={() => saveEdit(d.id)}
                  disabled={busyId === d.id || !editValue.trim()}
                  className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {busyId === d.id ? <BrandedLoader size={12} variant="white" /> : "Save"}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  disabled={busyId === d.id}
                  className="rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text hover:bg-ff-lavender"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="text-sm text-ff-text">{d.name}</span>
                  <span className="ml-2 text-xs text-ff-textMuted">
                    {d.userCount} {d.userCount === 1 ? "person" : "people"}
                  </span>
                </div>
                {confirmingId === d.id ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ff-textMuted">Delete?</span>
                    <button
                      onClick={() => remove(d.id)}
                      disabled={busyId === d.id}
                      className="flex items-center justify-center rounded-ff bg-ff-danger px-2.5 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busyId === d.id ? <BrandedLoader size={12} variant="white" /> : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      disabled={busyId === d.id}
                      className="rounded-ff border border-ff-border px-2.5 py-1 text-ff-text hover:bg-ff-lavender"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingId(d.id);
                        setEditValue(d.name);
                      }}
                      title="Edit"
                      aria-label="Edit"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      onClick={() => setConfirmingId(d.id)}
                      title="Delete"
                      aria-label="Delete"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:border-ff-danger/40 hover:bg-ff-danger/10 hover:text-ff-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
