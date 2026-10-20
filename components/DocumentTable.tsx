import Link from "next/link";
import { AlertTriangle, FolderSearch, Copy, ExternalLink, Info, Clock } from "lucide-react";
import DocTypeIcon, { DOC_TYPE_LABEL } from "./DocTypeIcon";
import DocumentPreview from "./DocumentPreview";
import DownloadMenu from "./DownloadMenu";
import LiveNewDocBadge from "./LiveNewDocBadge";
import { LocalDate, LocalDateTime } from "./LocalDateTime";
import Badge, { type BadgeVariant } from "./Badge";
import AccessBadges from "./AccessBadges";

export type Involvement = {
  roles: string[];
  status?: { label: string; tone: "warning" | "success" | "danger" | "neutral" };
};

const INVOLVEMENT_TONE: Record<NonNullable<Involvement["status"]>["tone"], string> = {
  warning: "bg-ff-warning/15 text-ff-warning font-semibold",
  success: "bg-ff-success/15 text-ff-success",
  danger: "bg-ff-danger/10 text-ff-danger",
  neutral: "bg-ff-lavender text-ff-textMuted",
};

/** "Uploader" "Reviewer" chips plus one status chip, e.g. "Waiting on your review". */
/** The "Your part" column: what you did on this document, and where it
 * stands for you. Roles as plain text, status underneath. */
export function InvolvementCell({ involvement }: { involvement?: Involvement }) {
  if (!involvement) return <span className="text-ff-textMuted">-</span>;
  const dot = {
    success: "bg-ff-success",
    warning: "bg-ff-warning",
    danger: "bg-ff-danger",
    neutral: "bg-ff-textMuted/50",
  }[involvement.status?.tone ?? "neutral"];
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-ff-text">{involvement.roles.join(" · ")}</p>
      {involvement.status && (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ff-textMuted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          {involvement.status.label}
        </p>
      )}
    </div>
  );
}

export function InvolvementChips({ involvement, className = "" }: { involvement: Involvement; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 text-[11px] ${className}`}>
      <span className="text-ff-textMuted">You:</span>
      {involvement.roles.map((r) => (
        <span key={r} className="rounded-full border border-ff-border bg-white px-2 py-0.5 text-ff-text">
          {r}
        </span>
      ))}
      {involvement.status && (
        <span className={`rounded-full px-2 py-0.5 ${INVOLVEMENT_TONE[involvement.status.tone]}`}>{involvement.status.label}</span>
      )}
    </div>
  );
}

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
  // Short explanatory tag shown as a tooltip icon next to the title — e.g.
  // the revoke reason on app/dashboard/revoked/page.tsx.
  note?: string | null;
  // Hover detail for the status badge itself — e.g. "Round 2, waiting on
  // Manager Test" for a pending_review row (see app/dashboard/pending/
  // page.tsx). Optional since only the Review Dashboard currently has this
  // context to give.
  statusDetail?: string;
  // Replaces the status label where the document's own status would mislead,
  // e.g. "Request for Everyone" on a published team document waiting on you.
  statusLabel?: string;
  // Hides the download action for this row while keeping preview available —
  // used on the Revoked Documents page (app/dashboard/revoked/page.tsx) for
  // viewers who aren't a manager/superadmin/the document's uploader/owner:
  // revoked documents are viewable org-wide but not downloadable by them.
  hideDownload?: boolean;
  // How the viewer was involved, shown as small chips under the title (My
  // Work's "Everything I'm in"): their roles, and where their part stands now.
  involvement?: Involvement;
  // False when downloads are turned off for this document. Together with a
  // restricted visibility (always preview only), hides Download and opens
  // quick preview in the protected viewer (lib/access.ts downloadsAllowed).
  downloadable?: boolean;
  // Set by app/dashboard/page.tsx (Published listing) for a manager/
  // superadmin viewer (any document) or a contributor viewer (their own
  // uploads only) — this row's prior approved content is what's actually
  // shown/searched, but a NEW version is sitting in an active review round
  // right now. Drives the blinking "New version awaiting approval" badge.
  hasPendingApproval?: boolean;
  // Team access control (lib/access.ts): "restricted" rows show a Restricted
  // badge naming accessTeamNames; reviewBypassed shows "Review Bypassed".
  // Filled from the database by each listing page, not trusted from the
  // search index alone, so the badge is right even before a reindex.
  visibility?: "org" | "restricted";
  accessTeamNames?: string[];
  reviewBypassed?: boolean;
};

export const STATUS_VARIANT: Record<DocRow["status"], BadgeVariant> = {
  published: "success",
  pending_review: "warning",
  archived: "neutral",
  rejected: "danger",
  revoked: "warning",
};

export const STATUS_LABEL: Record<DocRow["status"], string> = {
  published: "Published",
  pending_review: "Pending Review",
  archived: "Archived",
  rejected: "Rejected",
  revoked: "Back in review",
};

export function StatusBadge({
  status,
  detail,
  label,
}: {
  status: DocRow["status"];
  label?: string;
  // What's actually happening right now, shown on hover — e.g. which round
  // it's on and who it's waiting on. Optional since most places this badge
  // renders (Published Documents, Home grid) don't have that context to
  // give; the Review Dashboard does (see app/dashboard/pending/page.tsx).
  detail?: string;
}) {
  return (
    <Badge variant={label ? "warning" : STATUS_VARIANT[status]} tooltip={detail}>
      {label ?? STATUS_LABEL[status]}
    </Badge>
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

/** Mirrors lib/access.ts downloadsAllowed for a listing row. */
export function isPreviewOnly(doc: Pick<DocRow, "visibility" | "downloadable">) {
  return doc.downloadable === false;
}

export default function DocumentTable({
  rows,
  hasFilters = false,
  categoryLabel = "Category",
}: {
  rows: DocRow[];
  hasFilters?: boolean;
  // Team lists show the folder in this column (team documents have no category).
  categoryLabel?: string;
}) {
  if (rows.length === 0) {
    return <EmptyDocuments hasFilters={hasFilters} />;
  }
  // Everything I'm in: how you're involved gets its own column.
  const showInvolvement = rows.some((r) => r.involvement);

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
          {/* With "Your part" (Everything I'm in) the Type column steps aside,
              since the icon by each name already shows the type, so the
              table still fits without scrolling sideways. */}
          {showInvolvement ? (
            <colgroup>
              <col className="w-[27%]" />
              <col className="w-[21%]" />
              <col className="w-[13%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[7%]" />
            </colgroup>
          )}
          <thead className="sticky top-0 z-10 border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              {showInvolvement && <th className="px-4 py-3 font-medium">Your part</th>}
              <th className="px-4 py-3 font-medium">{categoryLabel}</th>
              {!showInvolvement && <th className="px-4 py-3 font-medium">Type</th>}
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
                  {/* Title always gets the first line; labels (team only,
                      preview only, review bypassed) sit underneath, so a
                      title is never squeezed out of sight. */}
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
                    {doc.hasPendingApproval && (
                      <Badge
                        variant="warning"
                        solid
                        pulse
                        icon={<Clock className="h-3 w-3" aria-hidden />}
                        tooltip="A new version is waiting for approval"
                      >
                        Pending Approval
                      </Badge>
                    )}
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
                  <div className="mt-1 flex flex-wrap gap-1 pl-6 empty:hidden">
                    <AccessBadges visibility={doc.visibility} teamNames={doc.accessTeamNames} reviewBypassed={doc.reviewBypassed} downloadable={doc.downloadable} />
                  </div>
                </td>
                {showInvolvement && (
                  <td className="px-4 py-3">
                    <InvolvementCell involvement={doc.involvement} />
                  </td>
                )}
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate" title={doc.categoryName}>{doc.categoryName}</span>
                </td>
                {!showInvolvement && <td className="px-4 py-3 text-ff-textMuted">{DOC_TYPE_LABEL[doc.docType] ?? doc.docType}</td>}
                <td className="px-4 py-3">
                  <StatusBadge status={doc.status} detail={doc.statusDetail} label={doc.statusLabel} />
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate" title={doc.uploadedByName}>{doc.uploadedByName}</span>
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  <span className="block truncate">
                    {showInvolvement ? <LocalDate value={doc.updatedAt} /> : <LocalDateTime value={doc.updatedAt} />}
                  </span>
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
                        previewOnly={isPreviewOnly(doc)}
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
                        !doc.hideDownload &&
                        !isPreviewOnly(doc) && (
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
