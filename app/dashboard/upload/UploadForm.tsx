"use client";

import { reviewersFor, type ReviewerOption } from "@/lib/reviewerOptions";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import type { CategoryFormField } from "@/lib/formSchema";
import BrandedLoader from "@/components/BrandedLoader";
import DynamicField from "@/components/DynamicField";
import AlertModal from "@/components/AlertModal";
import Footer from "@/components/Footer";
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

type Reviewer = ReviewerOption;
type TeamOption = { id: string; name: string };

const DOC_TYPES = [
  { value: "ppt", label: "PPT" },
  { value: "video", label: "Video" },
  { value: "pdf", label: "PDF" },
  { value: "doc", label: "Doc" },
  { value: "excel", label: "Excel / CSV" },
  { value: "other", label: "Other" },
];

// The document type follows the file's extension, so nobody has to pick it
// (the server still checks the file really is that type).
function docTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv"].includes(ext)) return "excel";
  if (["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext)) return "video";
  return "other";
}

const titleFor = (filename: string) => filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

// "everyone" or a team id: one choice for where the document goes.
const EVERYONE = "everyone";
// The reviewer dropdown's "publish without review" choice (managers only).
const NO_REVIEW = "__no_review__";

// Upload, kept to four plain steps: file, where it goes, category (and its
// details), who reviews it. No hidden "More options": tags sit in step 1,
// and publish settings show only when publishing without review.
// A document goes to Everyone or to one team; more teams can be added later
// from its Manage tab.
export default function UploadForm({
  initialCategoryId,
  initialVisibility = null,
  initialTeamId = null,
  initialFolderId = null,
  myReportsToId,
  canBypassReview = false,
  canUploadForEveryone = true,
  managedTeamIds = [],
  teamOptions = [],
  myTeamIds = [],
}: {
  initialCategoryId?: string;
  // Where the Upload button was clicked: Everyone, or one team (and folder).
  initialVisibility?: "org" | "restricted" | null;
  initialTeamId?: string | null;
  initialFolderId?: string | null;
  // This uploader's default reviewing manager (Reports To in People), pre-
  // selected once the reviewer list loads.
  myReportsToId?: string | null;
  // Org managers may publish without review (labelled Review Bypassed), for
  // Everyone or any team. Enforced server-side (lib/access.ts canBypassReviewFor).
  canBypassReview?: boolean;
  // False when only a team role lets this person upload: team uploads only.
  canUploadForEveryone?: boolean;
  // Teams this person manages: their uploads there may skip review too.
  managedTeamIds?: string[];
  // Teams this uploader may upload to, see lib/access.ts uploadableTeamIds.
  teamOptions?: TeamOption[];
  myTeamIds?: string[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  // Required; filled in from the file's extension, and changeable.
  const [docType, setDocType] = useState("");
  const [reviewerChoice, setReviewerChoice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ documentId: string; title: string; reason: string } | null>(null);

  const [destination, setDestination] = useState<string>(() => {
    if (initialTeamId && teamOptions.some((t) => t.id === initialTeamId)) return initialTeamId;
    if (initialVisibility === "org" && canUploadForEveryone) return EVERYONE;
    if (canUploadForEveryone) return EVERYONE;
    return teamOptions.find((t) => myTeamIds.includes(t.id))?.id ?? teamOptions[0]?.id ?? "";
  });
  const visibility: "org" | "restricted" = destination === EVERYONE ? "org" : "restricted";
  const teamIds = visibility === "restricted" && destination ? [destination] : [];
  const destinationTeam = teamOptions.find((t) => t.id === destination) ?? null;

  // Folders of the chosen team (Home > My teams), if it has any.
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [folderId, setFolderId] = useState("");
  const folderTeamId = destinationTeam?.id ?? null;
  useEffect(() => {
    setFolderId(folderTeamId && folderTeamId === initialTeamId ? initialFolderId ?? "" : "");
    if (!folderTeamId) return setFolders([]);
    let cancelled = false;
    fetch(`/api/teams/${folderTeamId}/folders`)
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((d) => {
        if (!cancelled) setFolders(d.folders ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [folderTeamId, initialTeamId, initialFolderId]);

  // Publish settings, only used when publishing without review (otherwise
  // the reviewer decides them). Usual answers by default.
  const [announceToAll, setAnnounceToAll] = useState(true);
  const [allowFeedback, setAllowFeedback] = useState(true);
  const [shareEnabled, setShareEnabled] = useState(true);
  const [downloadable, setDownloadable] = useState(true);

  // Everyone documents go to org managers; a team document to its managers.
  const eligibleReviewers = reviewersFor(reviewers, visibility, teamIds);
  // Same rule as lib/access.ts canBypassReviewFor: never contributors.
  const bypassAllowed =
    visibility === "org" ? canBypassReview : teamIds.length > 0 && (canBypassReview || teamIds.every((t) => managedTeamIds.includes(t)));
  const bypassReview = bypassAllowed && reviewerChoice === NO_REVIEW;
  const outsideTeam = destinationTeam && !myTeamIds.includes(destinationTeam.id) ? destinationTeam : null;

  useEffect(() => {
    if (reviewerChoice === NO_REVIEW ? !bypassAllowed : reviewerChoice && !eligibleReviewers.some((r) => r.id === reviewerChoice)) {
      setReviewerChoice("");
    }
  }, [reviewerChoice, bypassAllowed, eligibleReviewers]);

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/reviewers").then((r) => r.json()).then((data: Reviewer[]) => {
      setReviewers(data);
      if (myReportsToId && data.some((r) => r.id === myReportsToId)) {
        setReviewerChoice((current) => current || myReportsToId);
      }
    });
  }, [myReportsToId]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // Team documents have no category (and so no category fields).
  const schema = visibility === "org" ? selectedCategory?.formSchema ?? [] : [];

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

  function pickFile(picked: File | null, input?: HTMLInputElement) {
    if (picked && picked.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(`"${picked.name}" is ${(picked.size / (1024 * 1024)).toFixed(0)} MB, over the ${MAX_UPLOAD_SIZE_MB} MB limit. Choose a smaller file.`);
      if (input) input.value = "";
      setFile(null);
      return;
    }
    setFile(picked);
    if (picked) {
      setDocType(docTypeFor(picked.name));
      setTitle((current) => current || titleFor(picked.name));
    }
  }

  function buildFormData(forceDuplicateOfId?: string) {
    const form = new FormData();
    form.set("file", file!);
    form.set("docType", docType);
    form.set("title", title);
    if (visibility === "org") form.set("categoryId", categoryId);
    form.set("ownerId", bypassReview ? "" : reviewerChoice);
    form.set("tags", tags);
    form.set("metadata", JSON.stringify(visibility === "org" ? fieldValues : {}));
    form.set("visibility", visibility);
    if (visibility === "restricted") form.set("teamIds", JSON.stringify(teamIds));
    if (folderTeamId && folderId) form.set("folderId", folderId);
    if (bypassReview) {
      form.set("bypassReview", "true");
      form.set("announceToAll", String(announceToAll));
      form.set("allowFeedback", String(allowFeedback));
      form.set("shareEnabled", String(shareEnabled && visibility === "org"));
      form.set("downloadable", String(downloadable));
    }
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
      setError(data?.error ?? "Upload failed, please try again.");
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
    if (!docType) return setError("Choose the file type.");
    if (!destination) return setError("Choose where this document goes.");
    if (visibility === "org" && !categoryId) return setError("Choose a category.");
    if (!bypassReview && !reviewerChoice) return setError("Choose who should review this upload.");
    const missing = missingRequiredFields();
    if (missing.length > 0) return setError(`Please fill in: ${missing.join(", ")}`);
    await submitUpload();
  }

  const label = "mb-1 block text-sm font-medium text-ff-text";
  const input = "w-full rounded-ff border border-ff-border px-3 py-2 text-sm";
  const step = "rounded-ff border border-ff-border bg-white p-4 shadow-ff";

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
          Upload a document
          <InfoTooltip
            text={
              bypassReview
                ? "It publishes as soon as you upload it, with a Review Bypassed label."
                : "Your reviewer approves it before anyone else can see it."
            }
          />
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. File */}
          <div className={step}>
            <label className={label}>1. File</label>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-ff border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
                file ? "border-ff-accent/50 bg-ff-accent/5" : "border-ff-border hover:border-ff-accent/50"
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <UploadCloud className="h-6 w-6 text-ff-accent" aria-hidden />
              {file ? (
                <span className="font-medium text-ff-text">{file.name}</span>
              ) : (
                <span className="text-ff-textMuted">Drop a file here, or click to choose one (up to {MAX_UPLOAD_SIZE_MB} MB)</span>
              )}
              <input type="file" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null, e.target)} />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11rem]">
              <div>
                <label className={label}>Title</label>
                <input required value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>File type</label>
                <select required value={docType} onChange={(e) => setDocType(e.target.value)} className={input}>
                  <option value="" disabled>
                    Choose...
                  </option>
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className={`${label} mt-3`}>
              Tags <span className="font-normal text-ff-textMuted">(optional, comma-separated)</span>
            </label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. enterprise, Q3" className={input} />
          </div>

          {/* 2. Where it goes */}
          <div className={step}>
            <label className={`${label} flex items-center gap-1`}>
              2. Who can see it
              <InfoTooltip
                text={`${
                  visibility === "org"
                    ? "Everyone can find it once it's approved."
                    : "Only that team can see it. Team documents can't be shared outside the company."
                }${canUploadForEveryone ? "" : " Your role lets you upload for your team only."}`}
              />
            </label>
            <select value={destination} onChange={(e) => setDestination(e.target.value)} className={input}>
              {!destination && <option value="">Choose...</option>}
              {canUploadForEveryone && <option value={EVERYONE}>Everyone in FireFlink</option>}
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  Only the {t.name} team
                </option>
              ))}
            </select>
            {outsideTeam && (
              <p className="mt-1 text-xs text-ff-warning">
                You aren&apos;t in {outsideTeam.name}: you&apos;ll see this document there, but none of its other documents.
              </p>
            )}
            {folders.length > 0 && (
              <>
                <label className={`${label} mt-3`}>Folder</label>
                <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={input}>
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* 3. Category and its details: documents for everyone only. Team
              documents are organised by the team's folders instead. */}
          {visibility === "org" && (
          <div className={step}>
            <label className={`${label} flex items-center gap-1`}>
              3. Category
              {selectedCategory?.description && <InfoTooltip text={selectedCategory.description} />}
            </label>
            <select
              required
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setFieldValues({});
              }}
              className={input}
            >
              <option value="" disabled>
                Choose a category...
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {schema.length > 0 && (
              <div className="mt-3 space-y-3 border-t border-ff-border pt-3">
                {schema.map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={fieldValues[field.id]}
                    onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.id]: v }))}
                  />
                ))}
              </div>
            )}
          </div>

          )}

          {/* Reviewer */}
          <div className={step}>
            <label className={`${label} flex items-center gap-1`}>
              {visibility === "org" ? 4 : 3}. Reviewer
              <InfoTooltip
                text={visibility === "org" ? "Any manager can review documents for everyone." : "A manager of that team, or the Global approver, can review it."}
              />
            </label>
            <select value={reviewerChoice} onChange={(e) => setReviewerChoice(e.target.value)} className={input}>
              <option value="" disabled>
                {visibility === "restricted" && eligibleReviewers.length === 0 ? "This team has no manager yet" : "Choose a reviewer..."}
              </option>
              {bypassAllowed && <option value={NO_REVIEW}>No review needed, publish now</option>}
              {eligibleReviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === myReportsToId ? " (your manager)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Publishing without review: the settings a reviewer would otherwise decide. */}
          {bypassReview && (
            <div className={step}>
              <label className={label}>Publish settings</label>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={announceToAll} onChange={(e) => setAnnounceToAll(e.target.checked)} />
                  Notify everyone who can see it
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allowFeedback} onChange={(e) => setAllowFeedback(e.target.checked)} />
                  Accept feedback
                </label>
                {visibility === "org" && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={shareEnabled} onChange={(e) => setShareEnabled(e.target.checked)} />
                    Allow share links for customers
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} />
                  Allow download
                </label>
              </div>
            </div>
          )}

          <AlertModal message={error} onClose={() => setError(null)} />

          {duplicateWarning && (
            <div className="rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-4 text-sm text-ff-text">
              <p className="mb-1 font-medium">This looks like a document that already exists</p>
              <p className="mb-3 text-ff-textMuted">
                {duplicateWarning.reason} Existing document:{" "}
                <a href={`/dashboard/documents/${duplicateWarning.documentId}`} target="_blank" rel="noreferrer" className="text-ff-accent hover:underline">
                  {duplicateWarning.title}
                </a>
                . If it&apos;s really different, upload it anyway and it will be marked as a possible duplicate.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitUpload(duplicateWarning.documentId)}
                  className="flex items-center justify-center rounded-ff bg-ff-warning px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? <BrandedLoader size={16} variant="white" /> : "Upload anyway"}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setDuplicateWarning(null)}
                  className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text hover:bg-ff-lavender"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !!duplicateWarning}
            className="flex w-full items-center justify-center rounded-ff bg-ff-accent-gradient px-4 py-2.5 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
          >
            {submitting ? <BrandedLoader size={16} variant="white" label="Uploading..." /> : bypassReview ? "Publish now" : "Send for review"}
          </button>
        </form>
      </div>
      <Footer />
    </main>
  );
}
