"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

// Manage-tab feedback control — a manager or this document's own uploader
// can turn new feedback collection on/off at any time (not just the
// one-time choice at approval, see ReviewActions.tsx) without removing what
// already exists. Accepting/closing/replying to individual feedback items
// used to live here too, but moved to the Feedback tab itself
// (components/DocumentFeedback.tsx, via components/HighlightCommentPanel.tsx's
// canTriage/onSetStatus/onSendReply) — triaging feedback is something you do
// while reading it, not a separate settings screen away from it.
export default function FeedbackManagement({
  documentId,
  initialFeedbackEnabled,
}: {
  documentId: string;
  initialFeedbackEnabled: boolean;
}) {
  const router = useRouter();
  const [feedbackEnabled, setFeedbackEnabled] = useState(initialFeedbackEnabled);
  const [busyToggle, setBusyToggle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleFeedback() {
    setBusyToggle(true);
    setError(null);
    const next = !feedbackEnabled;
    const res = await fetch(`/api/documents/${documentId}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackEnabled: next }),
    });
    setBusyToggle(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update this setting, please try again.");
      return;
    }
    setFeedbackEnabled(next);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-ff ${
              feedbackEnabled ? "bg-ff-success/10 text-ff-success" : "bg-ff-lavender text-ff-textMuted"
            }`}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ff-text">Accept New Feedback</p>
            <p className="text-xs text-ff-textMuted">
              Lets anyone viewing this document leave feedback. Turn off to stop taking new comments without
              removing what&apos;s already there.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={feedbackEnabled}
          aria-label={feedbackEnabled ? "Turn off new feedback" : "Turn on new feedback"}
          onClick={toggleFeedback}
          disabled={busyToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            feedbackEnabled ? "bg-ff-success" : "bg-ff-border"
          }`}
        >
          {busyToggle ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <BrandedLoader size={12} variant="white" />
            </span>
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                feedbackEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          )}
        </button>
      </div>

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
