"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

// Must match next.config.js's serverActions.bodySizeLimit — see
// app/dashboard/upload/UploadForm.tsx's identical constant for why this
// is duplicated rather than shared (client-side heads-up only, real
// enforcement is server-side).
const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

// Replaces the document's file with a new version — a single icon button
// inline with the rest of the top-of-page actions (Preview/Download/Revoke/
// Archive/Delete) that opens a modal, rather than its own labeled section
// further down the page. Who's allowed to do this depends on the
// document's current status — see canUploadVersion in app/dashboard/
// documents/[id]/page.tsx (this button just doesn't render if they're not)
// and the same checks re-enforced server-side in app/api/documents/[id]/
// versions/route.ts: locked entirely while a version is already
// pending_review, and narrowed to just the rejected version's own uploader
// once rejected. The document goes back to pending_review; the old version
// stays live until the new one is approved. There's no reviewer picker here
// on purpose — the server sends it straight back to everyone who was a
// reviewer in the previous round (see versions/route.ts), so a multi-
// approver loop stays intact, rather than making the uploader re-pick
// someone every time.
export default function UploadVersionForm({
  documentId,
  isRejected,
}: {
  documentId: string;
  // Only a rejected document is being "replaced" (the rejected file is
  // swapped out for a corrected one) — everywhere else this is adding a new
  // version on top of a document that's still live, so the label should
  // read as an addition, not a replacement.
  isRejected: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [changelog, setChangelog] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setFile(null);
    setChangelog("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a file to upload.");

    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("changelog", changelog);

    const res = await fetch(`/api/documents/${documentId}/versions`, { method: "POST", body: form });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Upload failed — please try again.");
      return;
    }

    reset();
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isRejected ? "Replace with a new version" : "Upload a new version"}
        className="flex items-center gap-1.5 rounded-ff border border-ff-border px-3 py-2 text-sm text-ff-textMuted transition-colors hover:border-ff-accent/40 hover:bg-ff-accent/10 hover:text-ff-accent"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {isRejected ? "Replace Document" : "Upload New Version"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && reset()}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-ff bg-white p-5 shadow-ff-lg"
          >
            <h2 className="mb-4 flex items-center gap-1.5 text-base font-semibold text-ff-text">
              {isRejected ? "Replace With a New Version" : "Upload a New Version"}
              <InfoTooltip text="Replaces the current file with a new one under this same document, and sends it back to everyone who reviewed it last round. The old version stays visible until this one is approved." />
            </h2>

            <div className="mb-3">
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

            <div className="mb-4">
              <label className="mb-1 block text-xs text-ff-textMuted">Changelog (optional)</label>
              <textarea
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                placeholder="What changed in this version?"
                rows={2}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={submitting}
                className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
              >
                {submitting ? <BrandedLoader size={16} variant="white" label="Uploading..." /> : "Submit for Review"}
              </button>
            </div>
          </form>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
