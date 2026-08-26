"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { slugifyFieldId, type CategoryFormField, type CategoryFieldType } from "@/lib/formSchema";
import AlertModal from "@/components/AlertModal";

const FIELD_TYPES: { value: CategoryFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Yes / No" },
];

type DraftField = CategoryFormField & { optionsRaw?: string };

export default function CategoryFormBuilder({
  mode,
  categoryId,
  initial,
}: {
  mode: "create" | "edit";
  categoryId?: string;
  initial?: {
    name: string;
    description: string;
    reviewCycleDays: number | null;
    formSchema: CategoryFormField[];
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // null means "no review cycle" — documents uploaded into this category
  // default to permanent (never staleness-flagged) instead of needing a
  // manager to mark each one permanent individually.
  const [reviewCycleDays, setReviewCycleDays] = useState<number | null>(initial?.reviewCycleDays ?? 90);
  const [fields, setFields] = useState<DraftField[]>(
    (initial?.formSchema ?? []).map((f) => ({ ...f, optionsRaw: f.options?.join(", ") ?? "" }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fields already defined on OTHER categories — shown as one-click "reuse
  // this" suggestions so a manager building a new form sees what already
  // exists (e.g. "Client Name") before typing a near-duplicate of their own
  // (e.g. "Client") that fragments the same concept across categories.
  const [existingFields, setExistingFields] = useState<
    { label: string; type: CategoryFieldType; options?: string[]; categoryName: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((categories: { id: string; name: string; formSchema: CategoryFormField[] }[]) => {
        const seen = new Map<string, { label: string; type: CategoryFieldType; options?: string[]; categoryName: string }>();
        for (const c of categories) {
          if (c.id === categoryId) continue; // don't suggest this category's own fields back to itself
          for (const f of c.formSchema ?? []) {
            const key = f.label.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.set(key, { label: f.label, type: f.type, options: f.options, categoryName: c.name });
          }
        }
        setExistingFields(Array.from(seen.values()));
      })
      .catch(() => {});
  }, [categoryId]);

  // Case-insensitive label -> count, within the form currently being built —
  // used to flag actual duplicates as the manager types, not just fields
  // that happen to share a type.
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of fields) {
      const key = f.label.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [fields]);

  const reusableSuggestions = existingFields.filter(
    (ef) => !fields.some((f) => f.label.trim().toLowerCase() === ef.label.trim().toLowerCase())
  );

  function addField(preset?: { label: string; type: CategoryFieldType; options?: string[] }) {
    setFields((prev) => [
      ...prev,
      {
        id: "",
        label: preset?.label ?? "",
        type: preset?.type ?? "text",
        required: false,
        optionsRaw: preset?.options?.join(", ") ?? "",
      },
    ]);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const duplicateLabel = [...labelCounts.entries()].find(([, count]) => count > 1)?.[0];
    if (duplicateLabel) {
      setError(`"${duplicateLabel}" is used more than once in this form — field labels must be unique.`);
      return;
    }

    setSaving(true);

    const cleanedFields: CategoryFormField[] = fields
      .filter((f) => f.label.trim().length > 0)
      .map((f) => ({
        id: f.id || slugifyFieldId(f.label),
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        ...(f.type === "select"
          ? { options: (f.optionsRaw ?? "").split(",").map((o) => o.trim()).filter(Boolean) }
          : {}),
      }));

    const payload = { name, description, reviewCycleDays, formSchema: cleanedFields };
    const url = mode === "create" ? "/api/categories" : `/api/categories/${categoryId}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save this category.");
      return;
    }
    router.push("/admin/categories");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <h2 className="mb-3 text-base font-bold text-ff-text">Category details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">
              Review cycle (days before flagged outdated)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                disabled={reviewCycleDays === null}
                value={reviewCycleDays ?? ""}
                onChange={(e) => setReviewCycleDays(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm disabled:bg-ff-lavender/40 disabled:text-ff-textMuted"
              />
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ff-textMuted">
                <input
                  type="checkbox"
                  checked={reviewCycleDays === null}
                  onChange={(e) => setReviewCycleDays(e.target.checked ? null : 90)}
                />
                None
              </label>
            </div>
            {reviewCycleDays === null && (
              <p className="mt-1 text-xs text-ff-textMuted">
                Documents uploaded into this category are marked permanent by default and never flagged for re-review.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-ff-textMuted">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold text-ff-text">Upload form for this category</h2>
          <button
            type="button"
            onClick={() => addField()}
            className="flex items-center gap-1 rounded-ff border border-ff-border px-3 py-1.5 text-xs font-medium text-ff-accent hover:bg-ff-lavender"
          >
            <Plus className="h-3.5 w-3.5" /> Add Field
          </button>
        </div>
        <p className="mb-4 text-xs text-ff-textMuted">
          These questions appear whenever someone uploads a document, PPT, or video into this
          category. Required fields must be answered before the upload can be submitted.
        </p>

        {reusableSuggestions.length > 0 && (
          <div className="mb-4 rounded-ff border border-ff-border bg-ff-lavender/40 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ff-text">
              <Sparkles className="h-3.5 w-3.5 text-ff-accent" aria-hidden />
              Already used on other categories. Reuse instead of creating a near-duplicate:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {reusableSuggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => addField(s)}
                  title={`Used on "${s.categoryName}"`}
                  className="rounded-full border border-ff-border bg-white px-2.5 py-1 text-xs text-ff-text transition-colors hover:border-ff-accent hover:text-ff-accent"
                >
                  + {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {fields.length === 0 && (
          <p className="rounded-ff bg-ff-lavender/60 p-3 text-xs text-ff-textMuted">
            No custom fields yet. Uploaders will only be asked for a title and tags.
          </p>
        )}

        <div className="space-y-3">
          {fields.map((f, i) => {
            const key = f.label.trim().toLowerCase();
            const isDuplicate = key.length > 0 && (labelCounts.get(key) ?? 0) > 1;
            return (
            <div key={i} className="rounded-ff border border-ff-border p-3">
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto_auto]">
                <div>
                  <input
                    placeholder="Field label, e.g. Competitor Name"
                    required
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    className={`w-full rounded-ff border px-2 py-1.5 text-sm ${isDuplicate ? "border-ff-danger" : "border-ff-border"}`}
                  />
                  {isDuplicate && (
                    <p className="mt-1 text-xs text-ff-danger">
                      Already used elsewhere in this form. Pick a different label.
                    </p>
                  )}
                </div>
                <select
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as CategoryFieldType })}
                  className="rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ff-textMuted">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  aria-label="Remove field"
                  className="rounded p-1.5 text-ff-danger hover:bg-ff-danger/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {f.type === "select" && (
                <input
                  placeholder="Options, comma-separated, e.g. APAC, EMEA, NA"
                  value={f.optionsRaw ?? ""}
                  onChange={(e) => updateField(i, { optionsRaw: e.target.value })}
                  className="mt-2 w-full rounded-ff border border-ff-border px-2 py-1.5 text-sm"
                />
              )}
            </div>
            );
          })}
        </div>
      </div>

      <AlertModal message={error} onClose={() => setError(null)} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
        >
          {saving ? "Saving..." : mode === "create" ? "Create Category" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
