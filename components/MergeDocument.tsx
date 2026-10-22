"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Search } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import ConfirmModal from "@/components/ConfirmModal";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";
import DocTypeIcon, { DOC_TYPE_LABEL } from "@/components/DocTypeIcon";

type Target = { id: string; title: string; docType: string; where: string; direct: boolean };

export type PendingMerge = { targetTitle: string; approverName: string; mine: boolean };

// "Merge" on the Manage tab (lib/merge.ts): pick the document to keep, and
// this one is removed. Merges straight away when you manage the one you
// keep; otherwise its manager gets a merge request to approve.
export default function MergeDocument({
  documentId,
  documentTitle,
  suggestedTitle,
  pending,
}: {
  documentId: string;
  documentTitle: string;
  // A flagged duplicate's original, prefilled as the search.
  suggestedTitle: string | null;
  pending: PendingMerge | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Target[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/documents/${documentId}/merge?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => null);
      setSearching(false);
      setResults(res.ok ? data?.results ?? [] : []);
    }, 300);
    return () => clearTimeout(t);
  }, [open, query, documentId]);

  function start() {
    setQuery(suggestedTitle ?? "");
    setSelected(null);
    setOpen(true);
  }

  async function confirm() {
    if (!selected) return setError("Choose the document to keep.");
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: selected.id }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(data?.error ?? "Could not merge, please try again.");
    setOpen(false);
    if (data?.merged) {
      // This document is gone now: land on the one that was kept.
      router.push(`/dashboard/documents/${data.targetId}`);
      router.refresh();
      return;
    }
    setNotice(`Request sent to ${data?.approverName ?? "its manager"}. Nothing changes until they approve.`);
    router.refresh();
  }

  async function withdraw() {
    setBusy(true);
    const res = await fetch(`/api/documents/${documentId}/merge`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(data?.error ?? "Could not withdraw, please try again.");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent/10 text-ff-accent">
            <GitMerge className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
              Merge
              <InfoTooltip text="For the same file uploaded twice, like a video under two names. Pick the document to keep: this one is removed and its tags and teams move to it. If you don't manage that document, its manager approves first. A removed document can be restored from Deleted for 30 days." />
            </p>
            <p className="text-xs text-ff-textMuted">
              {pending
                ? `Waiting on ${pending.approverName} to approve merging this into "${pending.targetTitle}".`
                : "Uploaded twice? Merge this into the copy to keep."}
            </p>
          </div>
        </div>
        {pending ? (
          pending.mine && (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="flex shrink-0 items-center justify-center rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-60"
            >
              {busy ? <BrandedLoader size={14} /> : "Withdraw"}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={start}
            className="flex shrink-0 items-center justify-center rounded-ff border border-ff-border px-3 py-1.5 text-sm text-ff-text transition-colors hover:bg-ff-lavender"
          >
            Merge
          </button>
        )}
      </div>

      <ConfirmModal
        open={open}
        title="Merge into another document"
        confirmLabel={selected && !selected.direct ? "Send request" : "Merge"}
        danger={false}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      >
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ff-textMuted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Find the document to keep"
            className="w-full rounded-ff border border-ff-border py-2 pl-8 pr-2 text-sm"
          />
        </label>

        <div className="mt-2 max-h-56 overflow-y-auto">
          {searching ? (
            <div className="flex justify-center py-4">
              <BrandedLoader size={16} />
            </div>
          ) : query.trim() && results.length === 0 ? (
            <p className="py-3 text-center text-xs text-ff-textMuted">No documents found.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={`flex w-full items-start gap-2 rounded-ff px-2 py-2 text-left text-sm transition-colors ${
                  selected?.id === r.id ? "bg-ff-lavender ring-1 ring-ff-accent/40" : "hover:bg-ff-lavender/50"
                }`}
              >
                <DocTypeIcon docType={r.docType} className="mt-0.5 h-4 w-4 shrink-0 text-ff-textMuted" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ff-text">{r.title}</span>
                  <span className="block text-xs text-ff-textMuted">
                    {DOC_TYPE_LABEL[r.docType] ?? r.docType} · {r.where}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {selected && (
          <p className="mt-3 rounded-ff bg-ff-lavender/40 px-3 py-2 text-xs text-ff-text">
            {selected.direct
              ? `"${documentTitle}" will be removed and "${selected.title}" kept.`
              : `"${selected.title}" isn't yours to manage, so its manager will be asked to approve.`}
          </p>
        )}
      </ConfirmModal>

      <AlertModal message={error} onClose={() => setError(null)} />
      <AlertModal title="Request sent" message={notice} onClose={() => setNotice(null)} />
    </>
  );
}
