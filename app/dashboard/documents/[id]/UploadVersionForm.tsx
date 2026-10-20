"use client";

import { reviewersFor, type ReviewerOption } from "@/lib/reviewerOptions";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
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
type Reviewer = ReviewerOption;

export default function UploadVersionForm({
  documentId,
  isRejected,
  canBypassReview = false,
  restrictedToTeamIds = null,
}: {
  documentId: string;
  // Only a rejected document is being "replaced" (the rejected file is
  // swapped out for a corrected one) — everywhere else this is adding a new
  // version on top of a document that's still live, so the label should
  // read as an addition, not a replacement.
  isRejected: boolean;
  // Managers may publish the new version directly ("No review needed"),
  // which labels the document Review Bypassed. Enforced server-side too.
  canBypassReview?: boolean;
  // Team ids of a restricted document (null for an org-wide one): limits the
  // reviewer picker to managers of those teams.
  restrictedToTeamIds?: string[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [changelog, setChangelog] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ documentId: string; title: string; reason: string } | null>(null);
  const [bypassReview, setBypassReview] = useState(false);
  // Filled only after the server answers needsReviewer: nobody from the last
  // round can review this version (e.g. it was published without review).
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [reviewerId, setReviewerId] = useState("");

  async function loadReviewers() {
    const data: Reviewer[] = await fetch("/api/reviewers").then((r) => r.json()).catch(() => []);
    setReviewers(
      reviewersFor(data, restrictedToTeamIds ? "restricted" : "org", restrictedToTeamIds ?? [])
    );
  }

  function reset() {
    setOpen(false);
    setFile(null);
    setChangelog("");
    setError(null);
    setDuplicateWarning(null);
    setBypassReview(false);
    setReviewers(null);
    setReviewerId("");
  }

  async function submitUpload(forceDuplicateOfId?: string) {
    if (!file) return setError("Choose a file to upload.");
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("changelog", changelog);
    if (bypassReview) form.set("bypassReview", "true");
    else if (reviewerId) form.set("reviewerId", reviewerId);
    if (forceDuplicateOfId) {
      form.set("confirmDuplicate", "true");
      form.set("duplicateOfId", forceDuplicateOfId);
    }

    const res = await fetch(`/api/documents/${documentId}/versions`, { method: "POST", body: form });
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
      if (data?.needsReviewer && reviewers === null) await loadReviewers();
      setError(data?.error ?? "Upload failed, please try again.");
      return;
    }

    reset();
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicateWarning(null);
    await submitUpload();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isRejected ? "Replace with a new version" : "Upload a new version"}
        // Highlighted with the platform's primary button style (the same
        // plum gradient as Upload Document / Approve), so it reads as the
        // main next step while matching the rest of the app.
        className="flex items-center gap-1.5 rounded-ff bg-ff-accent-gradient px-3 py-2 text-sm font-semibold text-white shadow-ff ring-2 ring-ff-accent/20 transition-all hover:shadow-ff-md hover:brightness-110"
      >
        <FileUp className="h-4 w-4" aria-hidden />
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

            {canBypassReview && (
              <label className="mb-4 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={bypassReview} onChange={(e) => setBypassReview(e.target.checked)} />
                <span>
                  <span className="font-semibold text-ff-text">No review needed</span>
                  <span className="block text-xs text-ff-textMuted">
                    Publish this version directly. The document will carry a Review Bypassed label.
                  </span>
                </span>
              </label>
            )}

            {!bypassReview && reviewers !== null && (
              <div className="mb-4">
                <label className="mb-1 block text-xs text-ff-textMuted">Reviewer</label>
                <select
                  required
                  value={reviewerId}
                  onChange={(e) => setReviewerId(e.target.value)}
                  className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
                >
                  <option value="" disabled>
                    {reviewers.length === 0 ? "No eligible manager available" : "Choose a reviewer..."}
                  </option>
                  {reviewers.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            {duplicateWarning && (
              <div className="mb-4 rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3 text-xs text-ff-text">
                <p className="mb-1 font-medium">Possible duplicate</p>
                <p className="mb-2 text-ff-textMuted">
                  {duplicateWarning.reason} Existing document:{" "}
                  <a
                    href={`/dashboard/documents/${duplicateWarning.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ff-accent hover:underline"
                  >
                    {duplicateWarning.title}
                  </a>
                  . If this is genuinely different content, you can upload it anyway. It will be marked as a
                  possible duplicate so reviewers and other users can see it.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitUpload(duplicateWarning.documentId)}
                    className="flex items-center justify-center rounded-ff bg-ff-warning px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {submitting ? <BrandedLoader size={14} variant="white" /> : "Upload Anyway"}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setDuplicateWarning(null)}
                    className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

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
                disabled={submitting || !!duplicateWarning}
                className="flex items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
              >
                {submitting ? (
                  <BrandedLoader size={16} variant="white" label="Uploading..." />
                ) : bypassReview ? (
                  "Publish Now"
                ) : (
                  "Submit for Review"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
