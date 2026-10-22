"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitMerge } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import InfoTooltip from "@/components/InfoTooltip";
import AlertModal from "@/components/AlertModal";
import { formatDateTime } from "@/lib/formatDate";

export type MergeRequestInfo = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  // False when the approver can't open the copy (another team's document).
  sourceVisible: boolean;
  requestedByName: string;
  createdAt: string;
};

// Merge requests waiting on this document's manager (lib/merge.ts), above
// the tabs. Approving removes the other document and keeps this one.
export default function MergeRequestPanel({ requests }: { requests: MergeRequestInfo[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: "approve" | "decline") {
    setBusyId(`${id}:${decision}`);
    const res = await fetch(`/api/merge-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Something went wrong, please try again.");
      return;
    }
    router.refresh();
  }

  if (requests.length === 0) return null;
  return (
    <div className="rounded-ff border border-ff-accent/40 bg-white p-4 shadow-ff">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent/10 text-ff-accent">
          <GitMerge className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
            Merge request
            <InfoTooltip text="Someone uploaded the same thing again and asks to merge it into this document. Approve to keep this one and remove theirs (it can be restored from Deleted for 30 days). Its tags and teams are added here." />
          </p>
          <ul className="mt-2 space-y-3">
            {requests.map((r) => (
              <li key={r.id}>
                <p className="text-sm text-ff-text">
                  {r.requestedByName} asks to merge{" "}
                  {r.sourceVisible ? (
                    <Link href={`/dashboard/documents/${r.sourceId}`} className="font-medium text-ff-accent hover:underline">
                      &quot;{r.sourceTitle}&quot;
                    </Link>
                  ) : (
                    <strong>&quot;{r.sourceTitle}&quot;</strong>
                  )}{" "}
                  into this document.
                </p>
                <p className="text-xs text-ff-textMuted">{formatDateTime(r.createdAt)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => decide(r.id, "approve")}
                    className="inline-flex items-center gap-2 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {busyId === `${r.id}:approve` && <BrandedLoader size={12} variant="white" />}
                    Approve Merge
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => decide(r.id, "decline")}
                    className="inline-flex items-center gap-2 rounded-ff border border-ff-border px-3 py-1.5 text-xs font-semibold text-ff-text hover:bg-ff-lavender disabled:opacity-60"
                  >
                    {busyId === `${r.id}:decline` && <BrandedLoader size={12} />}
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
