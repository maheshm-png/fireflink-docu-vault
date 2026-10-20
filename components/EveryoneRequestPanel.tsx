"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import GlobalCategoryPicker from "@/components/GlobalCategoryPicker";
import InfoTooltip from "@/components/InfoTooltip";
import AlertModal from "@/components/AlertModal";
import { formatDateTime } from "@/lib/formatDate";

export type EveryoneRequestInfo = {
  requestedByName: string;
  reason: string;
  createdAt: string;
};

export type EveryoneDecisionInfo = {
  approved: boolean;
  decidedByName: string | null;
  comment: string | null;
  decidedAt: string | null;
};

// "Request for Everyone" on a team document (lib/access.ts,
// app/api/documents/[id]/everyone-request). Two modes:
//  - "request": a manager of the document's team, on the Manage tab. Raises
//    a request with a reason, sees it waiting, can withdraw their own, and
//    sees the last decision when it was sent back.
//  - "decide": the Global approver, above the tabs while a request waits.
//    Approves (the document becomes visible to everyone) or sends it back
//    with a comment.
export default function EveryoneRequestPanel({
  documentId,
  mode,
  pending,
  lastDecision = null,
  canWithdraw = false,
  approverName = null,
}: {
  documentId: string;
  mode: "request" | "decide";
  pending: EveryoneRequestInfo | null;
  lastDecision?: EveryoneDecisionInfo | null;
  canWithdraw?: boolean;
  // Who decides it (the one Global approver), shown before sending.
  approverName?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Approving needs the global category it joins (team documents have none).
  const [globalCategory, setGlobalCategory] = useState<{ categoryId: string; metadata: Record<string, unknown> }>({
    categoryId: "",
    metadata: {},
  });

  async function call(method: "POST" | "PATCH" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/everyone-request`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Something went wrong, please try again.");
      return false;
    }
    setText("");
    setComposing(false);
    router.refresh();
    return true;
  }

  const icon = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ff bg-ff-accent/10 text-ff-accent">
      <Globe className="h-4 w-4" aria-hidden />
    </span>
  );

  if (mode === "decide") {
    if (!pending) return null;
    return (
      <div className="rounded-ff border border-ff-accent/40 bg-white p-4 shadow-ff">
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
              Request for Everyone
              <InfoTooltip text="A team asked for this document to be visible to everyone in FireFlink. You see it because you are the Global approver." />
            </p>
            <p className="text-xs text-ff-textMuted">
              {pending.requestedByName} asked on {formatDateTime(pending.createdAt)}.
            </p>
            <p className="mt-2 rounded-ff bg-ff-lavender/40 px-3 py-2 text-sm text-ff-text">{pending.reason}</p>
            <div className="mt-3">
              <GlobalCategoryPicker value={globalCategory} onChange={setGlobalCategory} />
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Comment for the team (required to send back)"
              rows={2}
              className="mt-3 w-full rounded-ff border border-ff-border p-2 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!globalCategory.categoryId) return setError("Choose the category it belongs to for everyone.");
                  call("PATCH", { decision: "approve", comment: text, ...globalCategory });
                }}
                className="inline-flex items-center gap-2 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {busy && <BrandedLoader size={12} variant="white" />}
                Approve for Everyone
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!text.trim()) return setError("Add a comment so the team knows why it was sent back.");
                  call("PATCH", { decision: "send_back", comment: text });
                }}
                className="rounded-ff border border-ff-border px-3 py-1.5 text-xs font-semibold text-ff-text hover:bg-ff-lavender disabled:opacity-60"
              >
                Send Back
              </button>
            </div>
          </div>
        </div>
        <AlertModal message={error} onClose={() => setError(null)} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
            Request for Everyone
            <InfoTooltip text="Team documents can't be opened to everyone from inside the team. The Global approver approves the request or sends it back." />
          </p>
          {pending ? (
            <>
              <p className="text-xs text-ff-textMuted">
                {pending.requestedByName} asked on {formatDateTime(pending.createdAt)}. Waiting for{" "}
                {approverName ? <strong className="text-ff-text">{approverName}</strong> : "the Global approver"} to decide.
              </p>
              <p className="mt-2 rounded-ff bg-ff-lavender/40 px-3 py-2 text-sm text-ff-text">{pending.reason}</p>
              {canWithdraw && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("DELETE")}
                  className="mt-2 rounded-ff border border-ff-border px-3 py-1.5 text-xs font-semibold text-ff-text hover:bg-ff-lavender disabled:opacity-60"
                >
                  Withdraw Request
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-ff-textMuted">
                {approverName ? (
                  <>
                    Goes to <strong className="text-ff-text">{approverName}</strong> (Global approver).
                  </>
                ) : (
                  <span className="text-ff-warning">
                    No Global approver is set up yet, so requests can&apos;t be sent. Ask a superadmin to pick one in Settings.
                  </span>
                )}
              </p>
              {lastDecision && !lastDecision.approved && (
                <p className="mt-2 rounded-ff border border-ff-warning/40 bg-ff-warning/10 px-3 py-2 text-xs text-ff-text">
                  Last request sent back
                  {lastDecision.decidedByName ? ` by ${lastDecision.decidedByName}` : ""}
                  {lastDecision.decidedAt ? ` on ${formatDateTime(lastDecision.decidedAt)}` : ""}
                  {lastDecision.comment ? `: ${lastDecision.comment}` : "."}
                </p>
              )}
              {composing ? (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Why should everyone in the organization see this?"
                    rows={3}
                    className="mt-3 w-full rounded-ff border border-ff-border p-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!text.trim()) return setError("Say why everyone in the organization should see it.");
                        call("POST", { reason: text });
                      }}
                      className="inline-flex items-center gap-2 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {busy && <BrandedLoader size={12} variant="white" />}
                      {approverName ? `Send to ${approverName}` : "Send Request"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setComposing(false)}
                      className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text hover:bg-ff-lavender"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  disabled={!approverName}
                  className="mt-2 rounded-ff border border-ff-accent/40 px-3 py-1.5 text-xs font-semibold text-ff-accent hover:bg-ff-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {approverName ? `Request for Everyone (to ${approverName})` : "Request for Everyone"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
    </>
  );
}
