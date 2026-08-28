import Link from "next/link";
import { AlertTriangle, FolderSearch, Copy, ExternalLink, Info } from "lucide-react";
import DocTypeIcon, { DOC_TYPE_LABEL } from "./DocTypeIcon";
import DocumentPreview from "./DocumentPreview";
import DownloadMenu from "./DownloadMenu";
import LiveNewDocBadge from "./LiveNewDocBadge";
import { LocalDateTime } from "./LocalDateTime";

export type DocRow = {
  id: string;
  title: string;
  categoryName: string;
  docType: string;
  status: "pending_review" | "published" | "archived" | "rejected" | "revoked";
  uploadedByName: string;
  updatedAt: string;
  isStale: boolean;
  duplicateOfTitle?: string | null;
  extractedText?: string | null;
  // Whether there's a resolvable file to preview/download without a version
  // number — false for a document that's never been through approval even
  // once (fresh pending_review upload has a version, but no *current* one
  // yet). Defaults to true so existing callers (published-only listings,
  // where this is always the case) don't need to set it.
  hasCurrentVersion?: boolean;
  // Whether a LibreOffice-converted PDF exists for the previewed version —
  // see lib/officeConvert.ts. When true, quick preview renders through the
  // accurate PDF viewer instead of the lighter-weight PPT/Excel approximation.
  hasPreviewPdf?: boolean;
  // Which version quick preview/download should resolve — omit to fall back
  // to the document's current (last-approved) version. The Review Dashboard
  // sets this to the latest version's number, since a document mid-review
  // (pending_review after a new-version upload, or rejected) has a newer
  // version than currentVersion that's the actual thing awaiting a decision.
  version?: number;
  // Set for docType "link" documents — no file/version ever exists for
  // these, so quick preview/download need to branch on this instead.
  externalUrl?: string | null;
  // Per-round review progress (Review Dashboard only — app/dashboard/pending/
  // page.tsx) — drives the ReviewMilestones step bar in place of the plain
  // status pill for pending_review/rejected rows. Omitted everywhere else
  // (Published Documents, Home grid), so those keep the plain StatusBadge.
  reviewRounds?: { roundNumber: number; status: "pending" | "approved" | "rejected"; comments: string | null }[];
  // Short explanatory tag shown as a tooltip icon next to the title — e.g.
  // the revoke reason on app/dashboard/revoked/page.tsx.
  note?: string | null;
  // Hides the download action for this row while keeping preview available —
  // used on the Revoked Documents page (app/dashboard/revoked/page.tsx) for
  // viewers who aren't a manager/superadmin/the document's uploader/owner:
  // revoked documents are viewable org-wide but not downloadable by them.
  hideDownload?: boolean;
};

export const STATUS_BADGE: Record<DocRow["status"], string> = {
  published: "bg-ff-success/10 text-ff-success",
  pending_review: "bg-ff-warning/10 text-ff-warning",
  archived: "bg-ff-textMuted/10 text-ff-textMuted",
  rejected: "bg-ff-danger/10 text-ff-danger",
  revoked: "bg-ff-danger/10 text-ff-danger",
};

export const STATUS_LABEL: Record<DocRow["status"], string> = {
  published: "Published",
  pending_review: "Pending Review",
  archived: "Archived",
  rejected: "Rejected",
  revoked: "Revoked",
};

export function StatusBadge({ status }: { status: DocRow["status"] }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

type MilestoneStage = "done" | "current" | "rejected" | "closed" | "upcoming";

// A reviewer's row is force-set to "rejected" when a different reviewer
// rejects first (see app/api/documents/[id]/review/route.ts) — that's not a
// decision THEY made, so it shouldn't count as a real rejection here.
function isAutoClosed(r: { status: string; comments: string | null }) {
  return r.status === "rejected" && (r.comments?.startsWith("Auto-closed:") ?? false);
}

/** Delivery-tracker-style step bar: Uploaded → Round 1 → Round 2 (etc.) →
 * Published. Each round step reflects the ReviewRequest rows created for it
 * (see app/api/documents/[id]/review/route.ts's roundNumber) — approved once
 * every row in that round is approved, rejected if any row in it was, and
 * "current" (pulsing) while any row in it is still pending. Purely a visual
 * approximation of the real gating rule (a document only actually publishes
 * once EVERY pending row across every round is approved, not round-by-
 * round), but reads naturally as a left-to-right progress trail. */
function ReviewMilestones({
  rounds,
  documentStatus,
}: {
  rounds: { roundNumber: number; status: "pending" | "approved" | "rejected"; comments: string | null }[];
  documentStatus: DocRow["status"];
}) {
  const maxRound = rounds.length > 0 ? Math.max(...rounds.map((r) => r.roundNumber)) : 1;

  function roundStage(n: number): MilestoneStage {
    const inRound = rounds.filter((r) => r.roundNumber === n);
    if (inRound.some((r) => r.status === "rejected" && !isAutoClosed(r))) return "rejected";
    if (inRound.length > 0 && inRound.every((r) => r.status === "approved")) return "done";
    if (inRound.length > 0 && inRound.every((r) => isAutoClosed(r))) return "closed";
    return "current";
  }

  const steps: { key: string; content: string; stage: MilestoneStage; label: string }[] = [
    { key: "uploaded", content: "U", stage: "done", label: "Uploaded" },
  ];
  for (let n = 1; n <= maxRound; n++) {
    steps.push({ key: `round-${n}`, content: String(n), stage: roundStage(n), label: `Round ${n} review` });
  }
  steps.push({
    key: "published",
    content: "P",
    stage: documentStatus === "published" ? "done" : "upcoming",
    label: "Published",
  });

  return (
    <div className="flex items-center" title={steps.map((s) => `${s.label}: ${s.stage}`).join(" → ")}>
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              s.stage === "done"
                ? "bg-ff-success text-white"
                : s.stage === "current"
                ? "animate-pulse bg-ff-accent text-white"
                : s.stage === "rejected"
                ? "bg-ff-danger text-white"
                : "bg-ff-lavender text-ff-textMuted"
            }`}
          >
            {s.stage === "done" ? "✓" : s.stage === "rejected" ? "✕" : s.stage === "closed" ? "–" : s.content}
          </span>
          {i < steps.length - 1 && (
            <span className={`h-0.5 w-2.5 shrink-0 ${s.stage === "done" ? "bg-ff-success" : "bg-ff-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyDocuments({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-ff border border-ff-border bg-white p-10 text-center">
      <FolderSearch className="h-8 w-8 text-ff-textMuted" aria-hidden />
      <p className="font-medium text-ff-text">No documents found</p>
      <p className="text-sm text-ff-textMuted">
        {hasFilters ? "No documents match your current filters." : "Nothing here yet."}
      </p>
      {hasFilters && (
        <a href="?" className="mt-1 text-sm text-ff-accent hover:underline">
          Clear filters
        </a>
      )}
    </div>
  );
}

export default function DocumentTable({ rows, hasFilters = false }: { rows: DocRow[]; hasFilters?: boolean }) {
  if (rows.length === 0) {
    return <EmptyDocuments hasFilters={hasFilters} />;
  }

  return (
    // No inner scroll box here — this used to have its own max-h-[70vh]
    // overflow-y-auto, which meant the page (already scrollable via
    // <main>) and this table were two separate, independently-scrolling
    // regions stacked on top of each other. Besides showing two scrollbars,
    // the inner one only ran the height of this box, not the actual
    // browser window, so it read as floating/misaligned rather than
    // reaching the edge of the page. The sticky header below now sticks
    // relative to <main>'s scroll instead, which is the more natural
    // "stays pinned as you scroll the page" behavior anyway.
    <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Uploaded By</th>
              <th className="px-4 py-3 font-medium">Updated On</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => (
              <tr key={doc.id} className="border-t border-ff-border transition-colors hover:bg-ff-lavender/60">
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <DocTypeIcon docType={doc.docType} className="h-4 w-4 shrink-0 text-ff-textMuted" />
                    <Link
                      href={`/dashboard/documents/${doc.id}`}
                      title={doc.title}
                      className="min-w-0 truncate text-ff-accent hover:underline"
                    >
                      {doc.title}
                    </Link>
                    <LiveNewDocBadge documentId={doc.id} className="shrink-0" />
                    {doc.isStale && (
                      <AlertTriangle
                        className="h-4 w-4 shrink-0 text-ff-warning"
                        aria-label="Flagged as potentially outdated"
                      />
                    )}
                    {doc.duplicateOfTitle && (
                      <span title={`Possible duplicate of "${doc.duplicateOfTitle}"`}>
                        <Copy
                          className="h-4 w-4 shrink-0 text-ff-warning"
                          aria-label={`Possible duplicate of "${doc.duplicateOfTitle}"`}
                        />
                      </span>
                    )}
                    {doc.note && (
                      <span title={doc.note}>
                        <Info className="h-4 w-4 shrink-0 text-ff-textMuted" aria-label={doc.note} />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate" title={doc.categoryName}>{doc.categoryName}</span>
                </td>
                <td className="px-4 py-3 text-ff-textMuted">{DOC_TYPE_LABEL[doc.docType] ?? doc.docType}</td>
                <td className="px-4 py-3">
                  {doc.reviewRounds && (doc.status === "pending_review" || doc.status === "rejected") ? (
                    <ReviewMilestones rounds={doc.reviewRounds} documentStatus={doc.status} />
                  ) : (
                    <StatusBadge status={doc.status} />
                  )}
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate" title={doc.uploadedByName}>{doc.uploadedByName}</span>
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate"><LocalDateTime value={doc.updatedAt} /></span>
                </td>
                <td className="px-4 py-3">
                  {(doc.hasCurrentVersion !== false || doc.externalUrl) && (
                    <div className="flex items-center gap-1">
                      <DocumentPreview
                        documentId={doc.id}
                        docType={doc.docType}
                        version={doc.version}
                        extractedText={doc.extractedText}
                        hasPreviewPdf={doc.hasPreviewPdf}
                        externalUrl={doc.externalUrl}
                        variant="icon"
                        label="Quick preview"
                      />
                      {doc.externalUrl ? (
                        !doc.hideDownload && (
                          <a
                            href={doc.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open link"
                            aria-label="Open link"
                            className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden />
                          </a>
                        )
                      ) : (
                        doc.hasCurrentVersion !== false &&
                        !doc.hideDownload && (
                          <DownloadMenu
                            documentId={doc.id}
                            version={doc.version}
                            hasPreviewPdf={doc.hasPreviewPdf}
                            docType={doc.docType}
                          />
                        )
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
