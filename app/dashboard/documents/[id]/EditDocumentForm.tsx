"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, FileEdit } from "lucide-react";
import type { CategoryFormField } from "@/lib/formSchema";
import DynamicField from "@/components/DynamicField";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";
import { DOC_TYPE_LABEL } from "@/components/DocTypeIcon";

export default function EditDocumentForm({
  documentId,
  initialTitle,
  initialDocType,
  initialTags,
  initialMetadata,
  categories,
  initialCategoryId,
  initialExtraCategoryIds,
}: {
  documentId: string;
  initialTitle: string;
  initialDocType: string;
  initialTags: string[];
  initialMetadata: Record<string, unknown>;
  // Every category, with its detail fields: the main category decides which
  // fields this document has; "Also show in" only lists it elsewhere.
  categories: { id: string; name: string; fields: CategoryFormField[] }[];
  initialCategoryId: string;
  initialExtraCategoryIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags.join(", "));
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(initialMetadata);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [extraIds, setExtraIds] = useState<string[]>(initialExtraCategoryIds);
  const fields = categories.find((c) => c.id === categoryId)?.fields ?? [];
  const mainName = categories.find((c) => c.id === initialCategoryId)?.name ?? "";
  const extraNames = categories.filter((c) => initialExtraCategoryIds.includes(c.id)).map((c) => c.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setFieldValue(id: string, value: any) {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        metadata: fieldValues,
        // Team documents have no category to send (no picker shown).
        ...(categories.length > 0 ? { categoryId, extraCategoryIds: extraIds.filter((id) => id !== categoryId) } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save changes, please try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-lavender text-ff-textMuted">
            <FileEdit className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
              Document Details
              <InfoTooltip
                text={
                  categories.length === 0
                    ? "Title and tags."
                    : `Title, tags, category (${mainName}${extraNames.length > 0 ? `, also in ${extraNames.join(", ")}` : ""}) and its fields.`
                }
              />
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="px-4 py-3">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent/10 text-ff-accent">
          <FileEdit className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h3 className="flex items-center gap-1 text-sm font-semibold text-ff-text">
            Edit Document Details
            <InfoTooltip text="Changes the document's details only. To replace the file, use Upload New Version." />
          </h3>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-ff-textMuted">Title</label>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">Document Type</label>
          <p className="w-full rounded-ff border border-ff-border bg-ff-lavender/30 px-3 py-2 text-sm text-ff-textMuted">
            {DOC_TYPE_LABEL[initialDocType] ?? initialDocType}
          </p>
          <p className="mt-1 text-xs text-ff-textMuted">Set at upload, not editable here.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">Tags (comma-separated)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {categories.length > 0 && (
      <div className="mb-3 border-t border-ff-border pt-3">
        <label className="mb-1 block text-xs text-ff-textMuted">Category</label>
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setExtraIds((prev) => prev.filter((id) => id !== e.target.value));
          }}
          className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm sm:w-72"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {categoryId !== initialCategoryId && (
          <p className="mt-1 text-xs text-ff-textMuted">Moving it changes which details it asks for; fill them in below.</p>
        )}

        {categories.length > 1 && (
          <>
            <label className="mb-1 mt-3 block text-xs text-ff-textMuted">Also show in (optional)</label>
            <div className="flex flex-wrap gap-2">
              {categories
                .filter((c) => c.id !== categoryId)
                .map((c) => {
                  const on = extraIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                        on ? "border-ff-accent bg-ff-accent/10 text-ff-accent" : "border-ff-border text-ff-textMuted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={on}
                        onChange={() => setExtraIds((prev) => (on ? prev.filter((id) => id !== c.id) : [...prev, c.id]))}
                      />
                      {c.name}
                    </label>
                  );
                })}
            </div>
            <p className="mt-1 text-xs text-ff-textMuted">The same document is listed there too. Nothing is copied.</p>
          </>
        )}
      </div>
      )}

      {fields.length > 0 && (
        <div className="mb-3 space-y-3 border-t border-ff-border pt-3">
          {fields.map((field) => (
            <div key={field.id}>
              <DynamicField
                field={field}
                value={fieldValues[field.id]}
                onChange={(v) => setFieldValue(field.id, v)}
              />
            </div>
          ))}
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
        >
          {saving ? <BrandedLoader size={16} variant="white" label="Saving..." /> : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
