"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, FileEdit } from "lucide-react";
import type { CategoryFormField } from "@/lib/formSchema";
import DynamicField from "@/components/DynamicField";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import { DOC_TYPE_LABEL } from "@/components/DocTypeIcon";

export default function EditDocumentForm({
  documentId,
  initialTitle,
  initialDocType,
  initialTags,
  fields,
  initialMetadata,
}: {
  documentId: string;
  initialTitle: string;
  initialDocType: string;
  initialTags: string[];
  fields: CategoryFormField[];
  initialMetadata: Record<string, unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags.join(", "));
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(initialMetadata);
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
            <p className="text-sm font-semibold text-ff-text">Document Details</p>
            <p className="text-xs text-ff-textMuted">Title, tags, and category fields.</p>
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
          <h3 className="text-sm font-semibold text-ff-text">Edit Document Details</h3>
          <p className="text-xs text-ff-textMuted">
            Updates the document&apos;s info only. To replace the file itself, use the upload version button instead.
          </p>
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
