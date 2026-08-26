"use client";

import Link from "next/link";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import DocTypeIcon from "./DocTypeIcon";
import DocumentPreview from "./DocumentPreview";
import DownloadMenu from "./DownloadMenu";
import LiveNewDocBadge from "./LiveNewDocBadge";
import { type DocRow, StatusBadge, EmptyDocuments } from "./DocumentTable";
import { formatDateTime } from "@/lib/formatDate";

export default function DocumentGrid({ rows, hasFilters = false }: { rows: DocRow[]; hasFilters?: boolean }) {
  if (rows.length === 0) {
    return <EmptyDocuments hasFilters={hasFilters} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((doc) => (
        <Link
          key={doc.id}
          href={`/dashboard/documents/${doc.id}`}
          className="flex flex-col gap-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff transition-all hover:-translate-y-0.5 hover:border-ff-accent/30 hover:shadow-ff-md"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-lavender text-ff-accent">
              <DocTypeIcon docType={doc.docType} className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-1.5">
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
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <p className="line-clamp-2 font-medium text-ff-text">{doc.title}</p>
              <LiveNewDocBadge documentId={doc.id} className="shrink-0" />
            </div>
            <p className="mt-1 text-xs text-ff-textMuted">{doc.categoryName}</p>
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <StatusBadge status={doc.status} />
            <span className="truncate text-xs text-ff-textMuted">{doc.uploadedByName}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ff-textMuted">Updated {formatDateTime(doc.updatedAt)}</p>
            {(doc.hasCurrentVersion !== false || doc.externalUrl) && (
              <div className="flex items-center gap-0.5">
                <DocumentPreview
                  documentId={doc.id}
                  docType={doc.docType}
                  extractedText={doc.extractedText}
                  hasPreviewPdf={doc.hasPreviewPdf}
                  externalUrl={doc.externalUrl}
                  variant="icon"
                  label="Quick preview"
                />
                {doc.externalUrl ? (
                  !doc.hideDownload && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(doc.externalUrl!, "_blank");
                      }}
                      title="Open link"
                      aria-label="Open link"
                      className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </button>
                  )
                ) : (
                  doc.hasCurrentVersion !== false &&
                  !doc.hideDownload && (
                    <DownloadMenu
                      documentId={doc.id}
                      hasPreviewPdf={doc.hasPreviewPdf}
                      docType={doc.docType}
                      asButton
                    />
                  )
                )}
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
