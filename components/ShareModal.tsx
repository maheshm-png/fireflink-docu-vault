"use client";

import { useState } from "react";
import { Share2, Copy, Check, AlertTriangle, X, Eye, Download, Clock, Ban } from "lucide-react";
import AlertModal from "./AlertModal";
import BrandedLoader from "./BrandedLoader";

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

const ACCESS_OPTIONS: { value: "view" | "view_download"; label: string; Icon: typeof Eye }[] = [
  { value: "view", label: "View only", Icon: Eye },
  { value: "view_download", label: "View & download", Icon: Download },
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
  // Separate from `loading` (also used for the Generate/Update/Stop-sharing
  // actions below, where the form itself should stay visible and just show
  // a busy button) — this one specifically covers the very first fetch on
  // open, where there's nothing to show yet at all. Without a distinct flag
  // for that, the modal used to render the form immediately with silent
  // placeholder defaults while the real settings loaded in the background —
  // not actually broken, but with zero feedback that anything was
  // happening, which read as the dialog being slow/stuck.
  const [initialLoading, setInitialLoading] = useState(true);
  const [share, setShare] = useState<ShareState>(null);
  const [accessLevel, setAccessLevel] = useState<"view" | "view_download">("view");
  const [expirySelection, setExpirySelection] = useState("24");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setInitialLoading(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/share`);
    const data = await res.json().catch(() => null);
    setInitialLoading(false);
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

  // Takes an optional override for whichever field was just changed rather
  // than always reading its state — callers that auto-save (the confirm
  // popup below) fire this immediately on confirm, before a matching
  // setAccessLevel/setExpirySelection state update would have committed
  // yet, so reading the state directly there could still see the OLD value.
  async function generateLink(overrides?: { accessLevel?: "view" | "view_download"; expirySelection?: string }) {
    setLoading(true);
    setError(null);
    const effectiveAccess = overrides?.accessLevel ?? accessLevel;
    const effectiveExpiry = overrides?.expirySelection ?? expirySelection;
    const expiresInHours = effectiveExpiry === "never" ? null : Number(effectiveExpiry);
    const res = await fetch(`/api/documents/${documentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessLevel: effectiveAccess, expiresInHours }),
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
            className="w-full max-w-md overflow-hidden rounded-ff bg-white shadow-ff-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ff-border px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent-gradient text-white shadow-ff">
                  <Share2 className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-ff-text">Share Document</h2>
                  {/* Short enough to hold one line at this modal's width —
                      the original wording wrapped with just "required."
                      orphaned alone on its own line. */}
                  <p className="mt-0.5 text-xs text-ff-textMuted">Anyone with the link can view it, no login required.</p>
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

            {initialLoading ? (
              // The first fetch on open (current share settings, if any) —
              // see initialLoading's own comment for why this replaces the
              // form instead of the form quietly loading behind it.
              <div className="flex flex-col items-center justify-center gap-2 px-5 py-14">
                <BrandedLoader size={28} label="Loading sharing settings..." />
              </div>
            ) : (
            <div className="px-5 py-4">
              {/* Radio-style cards instead of a plain <select> for access
                  level — it's the one choice in this dialog with real
                  consequences (view vs. download), so it gets to be seen at
                  a glance rather than read off inside a closed dropdown. */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-ff-textMuted">Access</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACCESS_OPTIONS.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setAccessLevel(value);
                        // For an EXISTING link this applies right away —
                        // freely reversible by picking the other option
                        // again, so there's nothing a confirm step protects
                        // here beyond an extra click. Before a link exists
                        // yet, Generate Link below is still the one
                        // deliberate save action.
                        if (share) generateLink({ accessLevel: value });
                      }}
                      disabled={loading}
                      aria-pressed={accessLevel === value}
                      className={`flex items-center gap-2 rounded-ff border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60 ${
                        accessLevel === value
                          ? "border-ff-accent bg-ff-accent/10 text-ff-accent"
                          : "border-ff-border text-ff-text hover:bg-ff-lavender/40"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ff-textMuted">
                  <Clock className="h-3 w-3" aria-hidden />
                  Link expires in
                </label>
                <select
                  value={expirySelection}
                  onChange={(e) => {
                    const value = e.target.value;
                    setExpirySelection(value);
                    // Same reasoning as the Access buttons above — applies
                    // immediately for an existing link, freely reversible by
                    // picking again.
                    if (share) generateLink({ expirySelection: value });
                  }}
                  disabled={loading}
                  className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm text-ff-text focus:border-ff-accent focus:outline-none focus:ring-2 focus:ring-ff-accent/20"
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
                    <span className="font-semibold">This link has expired.</span> It no longer works for anyone who
                    has it. Pick a new expiry above to make it work again (same link, same URL).
                  </p>
                </div>
              )}

              {share && !share.expired && (
                <div className="rounded-ff border border-ff-border bg-ff-lavender/40 p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-ff-textMuted">Current link</p>
                    <p className="text-xs text-ff-textMuted">
                      {share.expiresAt === null ? (
                        "No expiry"
                      ) : (
                        <>Expires <ExpiresLabel value={share.expiresAt} /></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={share.url}
                      onFocus={(e) => e.target.select()}
                      className="min-w-0 flex-1 rounded-ff border border-ff-border bg-white px-2.5 py-2 text-xs text-ff-text"
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      title="Copy link"
                      className={`flex shrink-0 items-center gap-1.5 rounded-ff border px-3 py-2 text-xs font-medium transition-colors ${
                        copied
                          ? "border-ff-success/40 bg-ff-success/10 text-ff-success"
                          : "border-ff-border text-ff-text hover:bg-white"
                      }`}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {!initialLoading && (
            <div className="flex items-center justify-between gap-2 border-t border-ff-border bg-ff-lavender/20 px-5 py-3.5">
              {share ? (
                <button
                  type="button"
                  onClick={stopSharing}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-ff border border-ff-danger/30 px-3 py-2 text-xs font-medium text-ff-danger transition-colors hover:bg-ff-danger/10 disabled:opacity-60"
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                  Stop Sharing
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-ff border border-ff-border bg-white px-4 py-2 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
                >
                  Close
                </button>
                {/* Only for the very first link — once one exists, both
                    Access and Link expires in above save on their own
                    through the confirm popup, so there's no separate
                    "Update Link" action left needing its own button. */}
                {!share && (
                  <button
                    type="button"
                    onClick={() => generateLink()}
                    disabled={loading}
                    className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                  >
                    Generate Link
                  </button>
                )}
              </div>
            </div>
            )}
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
