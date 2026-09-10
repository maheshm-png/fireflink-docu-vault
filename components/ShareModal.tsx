"use client";

import { useState } from "react";
import { Share2, Copy, Check, AlertTriangle } from "lucide-react";
import AlertModal from "./AlertModal";

type ShareState = {
  url: string;
  accessLevel: "view" | "view_download";
  expiresAt: string | null;
  expired: boolean;
} | null;

// "never" is a select-friendly string sentinel for expiresInHours: null (no
// expiry) — the API itself takes a real null, not this string; see
// generateLink's JSON.parse-free conversion right before the fetch call.
const EXPIRY_OPTIONS: { label: string; value: string }[] = [
  { label: "1 hour", value: "1" },
  { label: "24 hours", value: "24" },
  { label: "7 days", value: String(24 * 7) },
  { label: "30 days", value: String(24 * 30) },
  { label: "90 days", value: String(24 * 90) },
  { label: "No expiry", value: "never" },
];

/**
 * "Anyone with the link" sharing, same idea as Google Docs' share dialog —
 * pick an access level and how long the link should last, generate it, copy
 * it. Opening this again for a document that's already shared shows its
 * current settings (updating them in place, same link) rather than issuing
 * a second link.
 */
export default function ShareModal({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [share, setShare] = useState<ShareState>(null);
  const [accessLevel, setAccessLevel] = useState<"view" | "view_download">("view");
  const [expirySelection, setExpirySelection] = useState("24");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/share`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(data?.error ?? "Could not load sharing settings.");
      return;
    }
    if (data.share) {
      setShare(data.share);
      setAccessLevel(data.share.accessLevel);
      setExpirySelection(data.share.expiresAt === null ? "never" : "24");
    }
  }

  async function generateLink() {
    setLoading(true);
    setError(null);
    const expiresInHours = expirySelection === "never" ? null : Number(expirySelection);
    const res = await fetch(`/api/documents/${documentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessLevel, expiresInHours }),
    });
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(data?.error ?? "Could not create the share link.");
      return;
    }
    setShare(data.share);
    setCopied(false);
  }

  async function stopSharing() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/share`, { method: "DELETE" });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not stop sharing.");
      return;
    }
    setShare(null);
  }

  async function copyLink() {
    if (!share) return;
    await navigator.clipboard.writeText(share.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Share"
        aria-label="Share"
        className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
      >
        <Share2 className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-ff bg-white p-5 shadow-ff-lg"
          >
            <h2 className="mb-4 flex items-center gap-1.5 text-base font-semibold text-ff-text">
              <Share2 className="h-4 w-4" aria-hidden />
              Share this document
            </h2>

            <p className="mb-4 text-xs text-ff-textMuted">
              Anyone with the link can access it — no FireFlink login required.
            </p>

            <div className="mb-3">
              <label className="mb-1 block text-xs text-ff-textMuted">Access</label>
              <select
                value={accessLevel}
                onChange={(e) => setAccessLevel(e.target.value as "view" | "view_download")}
                disabled={loading}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
              >
                <option value="view">Anyone with the link can view</option>
                <option value="view_download">Anyone with the link can view and download</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs text-ff-textMuted">Link expires in</label>
              <select
                value={expirySelection}
                onChange={(e) => setExpirySelection(e.target.value)}
                disabled={loading}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {share && share.expired && (
              <div className="mb-4 flex items-start gap-2 rounded-ff border border-ff-warning/40 bg-ff-warning/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ff-warning" aria-hidden />
                <p className="text-xs text-ff-text">
                  <span className="font-semibold">This link has expired</span> — it no longer works for anyone who
                  has it. Pick a new expiry above and click <strong>Update Link</strong> to make it work again
                  (same link, same URL).
                </p>
              </div>
            )}

            {share && !share.expired && (
              <div className="mb-4 rounded-ff border border-ff-border bg-ff-lavender/40 p-3">
                <p className="mb-2 text-xs text-ff-textMuted">
                  Current link ·{" "}
                  {share.expiresAt === null ? "no expiry" : (
                    <>expires <ExpiresLabel value={share.expiresAt} /></>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={share.url}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded-ff border border-ff-border bg-white px-2 py-1.5 text-xs text-ff-text"
                  />
                  <button
                    type="button"
                    onClick={copyLink}
                    title="Copy link"
                    className="flex shrink-0 items-center gap-1 rounded-ff border border-ff-border px-2 py-1.5 text-xs text-ff-text transition-colors hover:bg-white"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-ff-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              {share ? (
                <button
                  type="button"
                  onClick={stopSharing}
                  disabled={loading}
                  className="text-xs text-ff-danger hover:underline disabled:opacity-60"
                >
                  Stop sharing
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-ff border border-ff-border px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={generateLink}
                  disabled={loading}
                  className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                >
                  {share ? "Update Link" : "Generate Link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}

function ExpiresLabel({ value }: { value: string }) {
  // Small and self-contained enough not to warrant lib/formatDate.ts's
  // LocalDateTime component — same server/browser timezone reasoning
  // applies, but this whole component only ever renders client-side
  // already (ShareModal is "use client"), so a direct toLocaleString here
  // never hits that bug.
  return <>{new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>;
}
