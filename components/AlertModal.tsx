"use client";

// Shared blocking popup for action errors/alerts — replaces the old inline
// "text-ff-danger" message under a form/button. A blocking modal makes sure
// the person actually sees why something failed instead of a small red line
// that's easy to miss, especially for destructive/important actions.
export default function AlertModal({
  message,
  onClose,
  title = "Something went wrong",
}: {
  message: string | null;
  onClose: () => void;
  title?: string;
}) {
  if (!message) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-ff bg-white p-5 shadow-ff-lg"
      >
        <h2 className="mb-2 text-base font-semibold text-ff-text">{title}</h2>
        <p className="mb-4 text-sm text-ff-textMuted">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            autoFocus
            className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-opacity hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
