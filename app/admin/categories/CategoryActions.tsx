"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import BrandedLoader from "@/components/BrandedLoader";

type Option = { id: string; name: string };
const NEW = "__new__";

// "Move documents" and "Delete" for one category on the Categories page
// (managers and superadmins). Both send documents to an existing category
// or a new one named on the spot (lib/categoryMove.ts).
export default function CategoryActions({
  category,
  docCount,
  totalCount,
  otherCategories,
}: {
  category: Option;
  // Documents in it (docCount), and the same including deleted ones still
  // in the bin (totalCount), which also have to move before it can go.
  docCount: number;
  totalCount: number;
  otherCategories: Option[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"move" | "delete" | null>(null);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [docs, setDocs] = useState<{ id: string; title: string; status: string }[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: "move" | "delete") {
    setMode(next);
    setTarget("");
    setNewName("");
    setError(null);
    if (next === "move") {
      setDocs(null);
      setSelected(new Set());
      fetch(`/api/categories/${category.id}/documents`)
        .then((r) => r.json())
        .then((d) => {
          setDocs(d.documents ?? []);
          setSelected(new Set((d.documents ?? []).map((x: { id: string }) => x.id)));
        })
        .catch(() => setError("Could not load the documents."));
    }
  }

  function targetBody(): Record<string, string> | null {
    if (target === NEW) {
      if (!newName.trim()) return null;
      return { newCategoryName: newName.trim() };
    }
    return target ? { toCategoryId: target } : null;
  }

  async function submit() {
    const needsTarget = mode === "move" || totalCount > 0;
    const dest = targetBody();
    if (needsTarget && !dest) return setError(target === NEW ? "Enter a name for the new category." : "Choose where to move the documents.");
    if (mode === "move" && selected.size === 0) return setError("Choose at least one document.");
    setBusy(true);
    setError(null);
    const res =
      mode === "move"
        ? await fetch(`/api/categories/${category.id}/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentIds: [...selected], ...dest }),
          })
        : await fetch(`/api/categories/${category.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dest ?? {}),
          });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return setError(d.error ?? "Something went wrong. Try again.");
    }
    setMode(null);
    router.refresh();
  }

  const picker = (
    <div className="space-y-2">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
      >
        <option value="">Move to...</option>
        {otherCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW}>+ New category</option>
      </select>
      {target === NEW && (
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
        />
      )}
    </div>
  );

  const allSelected = docs !== null && docs.length > 0 && selected.size === docs.length;

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        {docCount > 0 && (
          <button onClick={() => open("move")} className="text-ff-accent hover:underline">
            Move documents
          </button>
        )}
        <button onClick={() => open("delete")} className="text-ff-danger hover:underline">
          Delete
        </button>
      </div>

      <ConfirmModal
        open={mode === "move"}
        title={`Move documents from ${category.name}`}
        confirmLabel="Move"
        danger={false}
        busy={busy}
        onConfirm={submit}
        onCancel={() => setMode(null)}
      >
        {docs === null && !error ? (
          <div className="flex justify-center py-4">
            <BrandedLoader size={20} />
          </div>
        ) : (
          <div className="space-y-3">
            {docs && docs.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-ff border border-ff-border">
                <label className="flex items-center gap-2 border-b border-ff-border bg-ff-lavender/40 px-3 py-2 text-xs font-medium text-ff-text">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)))}
                  />
                  Select all ({docs.length})
                </label>
                {docs.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ff-text">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        setSelected(next);
                      }}
                    />
                    <span className="truncate">{d.title}</span>
                  </label>
                ))}
              </div>
            )}
            {picker}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-ff-danger">{error}</p>}
      </ConfirmModal>

      <ConfirmModal
        open={mode === "delete"}
        title={`Delete ${category.name}?`}
        message={
          totalCount > 0
            ? `It has ${totalCount} document${totalCount === 1 ? "" : "s"}${totalCount > docCount ? " (some in Deleted)" : ""}. Choose where to move ${totalCount === 1 ? "it" : "them"} first.`
            : "It has no documents. This can't be undone."
        }
        confirmLabel="Delete"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setMode(null)}
      >
        {totalCount > 0 && picker}
        {error && <p className="mt-2 text-xs text-ff-danger">{error}</p>}
      </ConfirmModal>
    </>
  );
}
