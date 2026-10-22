"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Eye } from "lucide-react";
import ShareModal from "./ShareModal";
import InfoTooltip from "./InfoTooltip";

export type SharedLinkRow = {
  linkId: string;
  documentId: string;
  // Your own link: change it in the Share dialog. Someone else's (you're the
  // document's uploader/owner, or a superadmin): you can only stop it.
  mine: boolean;
  title: string;
  url: string;
  accessLevel: "view" | "view_download";
  expiresAt: string | null;
  createdAt: string;
  sharedBy: string;
  state: string;
  opens: number;
  downloads: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  // Colleagues signed in to the vault who opened it; customers stay unnamed.
  colleagues: string[];
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const OPENED_HINT =
  "Each person is counted once, however many times they reload or come back (counted per device and browser). The person opening it sees nothing about this. People outside the vault aren't named; colleagues signed in to the vault are. Your own opens of your own link don't count, and neither do chat link previews.";

// My Work > Shared links: every link the viewer manages, whether it has been
// opened (lib/shareTracking.ts), and the same Share dialog as the document
// page to change or stop it. Refreshes the list when that dialog closes.
export default function SharedLinksTable({ rows }: { rows: SharedLinkRow[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stop(r: SharedLinkRow) {
    if (!window.confirm(`Stop ${r.sharedBy}'s link to "${r.title}"? Anyone who has it won't be able to open it.`)) return;
    setStopping(r.linkId);
    setError(null);
    const res = await fetch(`/api/documents/${r.documentId}/share?linkId=${r.linkId}`, { method: "DELETE" });
    setStopping(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not stop this link.");
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
        No shared links yet. Open a published document and use Share to make one.
      </p>
    );
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <>
    {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
    <div className="overflow-x-auto rounded-ff border border-ff-border bg-white shadow-ff">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-ff-border bg-[#F4E9F2] text-xs font-semibold uppercase tracking-wide text-[#5B1F51]">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Link</th>
            <th className="px-4 py-3 font-medium">
              <span className="inline-flex items-center gap-1">
                Opened <InfoTooltip text={OPENED_HINT} />
              </span>
            </th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Shared by</th>
            <th className="px-4 py-3 font-medium">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ff-border">
          {rows.map((r) => {
            const active = r.state === "Active";
            return (
              <tr key={r.linkId} className="align-top hover:bg-ff-lavender/40">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/documents/${r.documentId}`} className="font-medium text-ff-text hover:text-ff-accent">
                    {r.title}
                  </Link>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ff-textMuted">
                    {r.accessLevel === "view_download" ? <Download className="h-3 w-3" aria-hidden /> : <Eye className="h-3 w-3" aria-hidden />}
                    {r.accessLevel === "view_download" ? "View & download" : "View only"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => copy(r.url)}
                    className="flex items-center gap-1.5 rounded-ff border border-ff-border px-2.5 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender"
                  >
                    {copied === r.url ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied === r.url ? "Copied" : "Copy link"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  {r.opens === 0 ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-ff-textMuted">Not opened yet</span>
                  ) : (
                    <>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        Opened by {r.opens === 1 ? "1 person" : `${r.opens} people`}
                      </span>
                      <p className="mt-1 text-xs text-ff-textMuted">
                        {r.firstOpenedAt && r.opens > 1 ? `First ${fmt(r.firstOpenedAt)}, last ` : r.opens === 1 ? "On " : "Last "}
                        {r.lastOpenedAt ? fmt(r.lastOpenedAt) : ""}
                      </p>
                      {r.colleagues.length > 0 && (
                        <p className="mt-1 text-xs text-ff-textMuted">Includes {r.colleagues.join(", ")} from the vault</p>
                      )}
                    </>
                  )}
                  {r.downloads > 0 && (
                    <p className="mt-1 text-xs text-ff-textMuted">Downloaded by {r.downloads === 1 ? "1 person" : `${r.downloads} people`}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      active ? "bg-ff-accent/10 font-medium text-ff-accent" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {r.state}
                  </span>
                  <p className="mt-1 text-xs text-ff-textMuted">{r.expiresAt ? `Until ${fmt(r.expiresAt)}` : "No expiry"}</p>
                </td>
                <td className="px-4 py-3 text-ff-textMuted">
                  {r.sharedBy}
                  <p className="text-xs">{fmt(r.createdAt)}</p>
                </td>
                <td className="px-4 py-3">
                  {r.mine ? (
                    <ShareModal documentId={r.documentId} label="Manage" onClose={() => router.refresh()} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => stop(r)}
                      disabled={stopping === r.linkId}
                      className="rounded-ff border border-ff-border bg-white px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      {stopping === r.linkId ? "Stopping..." : "Stop link"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
