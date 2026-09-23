"use client";

import { useState } from "react";
import { History, CheckCircle2, X } from "lucide-react";
import { LocalDateTime } from "./LocalDateTime";

type ApprovalEntry = {
  versionId: string;
  label: string;
  reviewerNames: string[];
  approvedAt: string | null;
};

/**
 * The non-stakeholder counterpart to the "Review History" link on
 * app/dashboard/documents/[id]/page.tsx (which sends a stakeholder into the
 * full Review tab). A plain view-only "user", or a contributor just passing
 * by someone else's document, doesn't get that full history — rejected
 * attempts, reviewer comments, who's currently assigned — none of that is
 * this viewer's business. What they DO get, in this modal instead of a
 * navigation, is the clean cut: which version, approved by whom, when.
 * Nothing here comes from a rejected or still-pending round.
 */
export default function ReviewHistoryModal({ entries }: { entries: ApprovalEntry[] }) {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View the document's approval history"
        className="flex shrink-0 items-center gap-1 rounded-full border border-ff-border px-2 py-0.5 text-xs font-medium text-ff-textMuted transition-colors hover:border-ff-accent/40 hover:text-ff-accent"
      >
        <History className="h-3 w-3" aria-hidden />
        Review History
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-ff bg-white shadow-ff-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ff-border px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent-gradient text-white shadow-ff">
                  <History className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-ff-text">Review History</h2>
                  <p className="mt-0.5 text-xs text-ff-textMuted">Which version, approved by whom.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <ul className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
              {entries.map((e, i) => (
                <li key={e.versionId} className="relative pl-6">
                  {i < entries.length - 1 && (
                    <div className="absolute left-[7px] top-5 bottom-[-12px] w-0.5 bg-ff-border" />
                  )}
                  <span className="absolute left-0 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ff-success text-white">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                  </span>
                  <p className="text-sm font-semibold text-ff-text">{e.label}</p>
                  <p className="text-xs text-ff-textMuted">
                    Approved by {e.reviewerNames.join(", ") || "a manager"}
                    {e.approvedAt && (
                      <>
                        {" "}
                        · <LocalDateTime value={e.approvedAt} />
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
