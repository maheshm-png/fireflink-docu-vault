"use client";

import BrandedLoader from "./BrandedLoader";

// Shared blocking popup for decision confirmations (delete, approve, reject,
// revoke, archive, restore, etc.) — replaces the old pattern of swapping a
// button for inline "Yes"/"Cancel" buttons + a text line next to it. A
// modal makes sure the choice is deliberate and the consequence is read,
// rather than a low-friction inline click easy to fire by accident.
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Red confirm button for destructive/reversal actions (delete, revoke,
  // reject); accent-gradient for constructive ones (approve, restore).
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Extra form content between the message and the buttons — e.g. the
  // revoke-reason input on RevokeButton.tsx.
  children?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-ff bg-white p-5 shadow-ff-lg"
      >
        <h2 className="mb-2 text-base font-semibold text-ff-text">{title}</h2>
        {message && <p className="mb-4 text-sm text-ff-textMuted">{message}</p>}
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex items-center justify-center rounded-ff px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${
              danger ? "bg-ff-danger" : "bg-ff-accent-gradient shadow-ff"
            }`}
          >
            {busy ? <BrandedLoader size={16} variant="white" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
