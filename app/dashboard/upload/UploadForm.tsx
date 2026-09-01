"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryFormField } from "@/lib/formSchema";
import BrandedLoader from "@/components/BrandedLoader";
import DynamicField from "@/components/DynamicField";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

// Must match next.config.js's serverActions.bodySizeLimit — this is only a
// client-side heads-up so the uploader isn't left waiting through a full
// transfer before finding out; the real enforcement is server-side.
const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

type Category = {
  id: string;
  name: string;
  description: string | null;
  formSchema: CategoryFormField[];
};

type Reviewer = { id: string; name: string; role: string };

const DOC_TYPES = [
  { value: "ppt", label: "PPT" },
  { value: "video", label: "Video" },
  { value: "pdf", label: "PDF" },
  { value: "doc", label: "Doc" },
  { value: "excel", label: "Excel / CSV" },
  { value: "other", label: "Other" },
];

export default function UploadForm({
  initialCategoryId,
  myReportsToId,
}: {
  initialCategoryId?: string;
  // This uploader's default reviewing manager (set by a superadmin in
  // Manage Users, contributors only — see app/admin/users/ReportsToSelect.tsx)
  // — pre-selected below once the reviewer list loads, though it's still
  // just a starting point; any active manager can be picked instead.
  myReportsToId?: string | null;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [docType, setDocType] = useState("other");
  const [ownerId, setOwnerId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ documentId: string; title: string; reason: string } | null>(null);

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/reviewers").then((r) => r.json()).then((data: Reviewer[]) => {
      setReviewers(data);
      if (myReportsToId && data.some((r) => r.id === myReportsToId)) {
        setOwnerId((current) => current || myReportsToId);
      }
    });
  }, [myReportsToId]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const schema = selectedCategory?.formSchema ?? [];

  function setFieldValue(id: string, value: any) {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
  }

  function missingRequiredFields(): string[] {
    return schema
      .filter((f) => f.required)
      .filter((f) => {
        const v = fieldValues[f.id];
        if (f.type === "checkbox") return v !== true && v !== false;
        return v === undefined || v === null || v === "";
      })
      .map((f) => f.label);
  }

  function buildFormData(forceDuplicateOfId?: string) {
    const form = new FormData();
    form.set("file", file!);
    form.set("docType", docType);
    form.set("title", title);
    form.set("categoryId", categoryId);
    form.set("ownerId", ownerId);
    form.set("tags", tags);
    form.set("metadata", JSON.stringify(fieldValues));
    if (forceDuplicateOfId) {
      form.set("confirmDuplicate", "true");
      form.set("duplicateOfId", forceDuplicateOfId);
    }
    return form;
  }

  async function submitUpload(forceDuplicateOfId?: string) {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/documents", { method: "POST", body: buildFormData(forceDuplicateOfId) });
    setSubmitting(false);

    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      if (data?.duplicate) {
        setDuplicateWarning(data.duplicate);
        return;
      }
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Upload failed — please try again.");
      return;
    }

    const { document } = await res.json();
    router.push(`/dashboard/documents/${document.id}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicateWarning(null);

    if (!file) return setError("Choose a file to upload.");
    if (!ownerId) return setError("Choose who should review this upload.");
    const missing = missingRequiredFields();
    if (missing.length > 0) {
      return setError(`Please fill in: ${missing.join(", ")}`);
    }

    await submitUpload();
  }

  return (
    <main className="flex-1 overflow-y-auto">
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
        Upload Document
        <InfoTooltip text="Your upload goes to your chosen reviewer first. It will not be visible to others until approved." />
      </h1>
      <p className="mb-6 text-sm text-ff-textMuted">Submit for review.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
          <label className="mb-1 block text-xs text-ff-textMuted">Category</label>
          <select
            required
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setFieldValues({}); }}
            className="mb-3 w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          >
            <option value="" disabled>Choose a category...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedCategory?.description && (
            <p className="mb-3 text-xs text-ff-textMuted">{selectedCategory.description}</p>
          )}

          <label className="mb-1 block text-xs text-ff-textMuted">Title</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-3 w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ff-textMuted">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
              >
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ff-textMuted">Reviewer</label>
              <select
                required
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
              >
                <option value="" disabled>Choose a reviewer...</option>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.id === myReportsToId ? " (suggested)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="mb-1 block text-xs text-ff-textMuted">Tags (comma-separated)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. enterprise, Q3, healthcare"
            className="mb-3 w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />

          <label className="mb-1 block text-xs text-ff-textMuted">File</label>
          <input
            required
            type="file"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              if (picked && picked.size > MAX_UPLOAD_SIZE_BYTES) {
                setError(`"${picked.name}" is ${(picked.size / (1024 * 1024)).toFixed(0)} MB, which is over the ${MAX_UPLOAD_SIZE_MB} MB limit. Choose a smaller file.`);
                e.target.value = "";
                setFile(null);
                return;
              }
              setFile(picked);
            }}
            className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ff-textMuted">Maximum file size: {MAX_UPLOAD_SIZE_MB} MB</p>
        </div>

        {schema.length > 0 && (
          <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
            <h2 className="mb-3 text-base font-bold text-ff-text">
              {selectedCategory?.name} details
            </h2>
            <div className="space-y-3">
              {schema.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  value={fieldValues[field.id]}
                  onChange={(v) => setFieldValue(field.id, v)}
                />
              ))}
            </div>
          </div>
        )}

        <AlertModal message={error} onClose={() => setError(null)} />

        {duplicateWarning && (
          <div className="rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-4 text-sm text-ff-text">
            <p className="mb-1 font-medium">Possible duplicate</p>
            <p className="mb-3 text-ff-textMuted">
              {duplicateWarning.reason} Existing document:{" "}
              <a
                href={`/dashboard/documents/${duplicateWarning.documentId}`}
                target="_blank"
                rel="noreferrer"
                className="text-ff-accent hover:underline"
              >
                {duplicateWarning.title}
              </a>
              . If this is genuinely different content, you can upload it anyway. It will be marked
              as a possible duplicate of that document so reviewers and other users can see it.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitUpload(duplicateWarning.documentId)}
                className="flex items-center justify-center rounded-ff bg-ff-warning px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? <BrandedLoader size={16} variant="white" /> : "Upload Anyway"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDuplicateWarning(null)}
                className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !!duplicateWarning}
          className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
        >
          {submitting ? <BrandedLoader size={16} variant="white" label="Uploading..." /> : "Submit for Review"}
        </button>
      </form>
    </div>
    </main>
  );
}
