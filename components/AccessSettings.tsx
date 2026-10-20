"use client";

import GlobalCategoryPicker from "@/components/GlobalCategoryPicker";
import InfoTooltip from "@/components/InfoTooltip";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Globe } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

export type TeamOption = { id: string; name: string; selectable: boolean };

// Manage-tab control for who can see a document (lib/access.ts): everyone in
// the organization, or only the chosen teams. Saves through PATCH
// /api/documents/[id]/access, which re-checks every rule below; the UI only
// mirrors them so nobody is offered a choice the server would refuse.
//  - teamOptions: teams the viewer may tick (teams they contribute to, or
//    every team for superadmins and the document's team managers) plus
//    teams already on the document, which show ticked but locked when the
//    viewer isn't in them.
//  - canOpenToOrg: false locks the "Everyone" option once restricted: only
//    a superadmin lifts it directly; team managers use Request for Everyone.
export default function AccessSettings({
  documentId,
  initialVisibility,
  initialTeamIds,
  teamOptions,
  canOpenToOrg,
}: {
  documentId: string;
  initialVisibility: "org" | "restricted";
  initialTeamIds: string[];
  teamOptions: TeamOption[];
  canOpenToOrg: boolean;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(initialVisibility);
  // Opening a team document to everyone needs the global category it joins.
  const [globalCategory, setGlobalCategory] = useState<{ categoryId: string; metadata: Record<string, unknown> }>({
    categoryId: "",
    metadata: {},
  });
  const needsCategory = initialVisibility === "restricted" && visibility === "org";
  const [teamIds, setTeamIds] = useState<string[]>(initialTeamIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty =
    visibility !== initialVisibility ||
    (visibility === "restricted" &&
      (teamIds.length !== initialTeamIds.length || teamIds.some((t) => !initialTeamIds.includes(t))));
  const orgLocked = initialVisibility === "restricted" && !canOpenToOrg;

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function save() {
    if (needsCategory && !globalCategory.categoryId) {
      setError("Choose the category it belongs to for everyone.");
      return;
    }
    if (visibility === "restricted" && teamIds.length === 0) {
      setError("Pick at least one team for a restricted document.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visibility,
        teamIds: visibility === "restricted" ? teamIds : [],
        ...(needsCategory ? globalCategory : {}),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not update who can see this document, please try again.");
      return;
    }
    if (data?.sharingTurnedOff) {
      setNotice("Public sharing was turned off. A manager in the document's team can turn it back on.");
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-ff ${
            visibility === "restricted" ? "bg-ff-accent/10 text-ff-accent" : "bg-ff-lavender text-ff-textMuted"
          }`}
        >
          {visibility === "restricted" ? <Lock className="h-4 w-4" aria-hidden /> : <Globe className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold text-ff-text">
            Who Can See This
            <InfoTooltip text={`Team documents are hidden from everyone outside the chosen teams, including search, the AI assistant and notifications. Superadmins and leaders with a leadership view of the team can see them.${orgLocked ? " To open it to everyone, a manager of its team uses Request for Everyone, which the Global approver decides." : ""}`} />
          </p>

          <div className="mt-3 flex flex-col gap-2 text-sm">
            <label className={`flex items-center gap-2 ${orgLocked ? "opacity-60" : ""}`}>
              <input
                type="radio"
                name={`visibility-${documentId}`}
                checked={visibility === "org"}
                disabled={orgLocked}
                onChange={() => setVisibility("org")}
              />
              Everyone in the organization
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`visibility-${documentId}`}
                checked={visibility === "restricted"}
                onChange={() => setVisibility("restricted")}
              />
              Restricted to teams
            </label>

          </div>

          {needsCategory && (
            <div className="mt-3">
              <GlobalCategoryPicker value={globalCategory} onChange={setGlobalCategory} />
            </div>
          )}
          {visibility === "restricted" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {teamOptions.length === 0 && (
                <p className="text-xs text-ff-warning">You aren&apos;t a contributor or manager in any team yet. Ask a superadmin to update your team role.</p>
              )}
              {teamOptions.map((t) => {
                const checked = teamIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    title={t.selectable ? undefined : "You can't change this team"}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                      checked ? "border-ff-accent bg-ff-accent/10 text-ff-accent" : "border-ff-border text-ff-textMuted"
                    } ${t.selectable ? "cursor-pointer" : "opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={!t.selectable}
                      onChange={() => toggleTeam(t.id)}
                    />
                    {t.name}
                  </label>
                );
              })}
            </div>
          )}

          {dirty && (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy && <BrandedLoader size={12} variant="white" />}
              Save access
            </button>
          )}
        </div>
      </div>
      <AlertModal message={error} onClose={() => setError(null)} />
      <AlertModal title="Access updated" message={notice} onClose={() => setNotice(null)} />
    </>
  );
}
