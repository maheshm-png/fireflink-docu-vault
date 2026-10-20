import { Lock, ShieldOff, EyeOff } from "lucide-react";
import Badge from "./Badge";

/**
 * The two document flags team access control added, shown together
 * wherever a document is listed or opened (DocumentTable, DocumentGrid, the
 * document detail header) so they read the same everywhere:
 *  - "<Team> only" (a restricted document): only the named teams can see it
 *    (lib/access.ts). Says which team, rather than a bare "Restricted".
 *  - "Review Bypassed": a manager published it straight from the upload form
 *    with "No review needed" (app/api/documents/route.ts).
 *  - "Preview only": downloads are turned off (lib/access.ts downloadsAllowed).
 *    Restricted documents are always preview only, so they say so in the
 *    Restricted tooltip instead of a second badge.
 * Both are static facts, so soft badges, never the solid/pulsing style.
 */
export default function AccessBadges({
  visibility,
  teamNames,
  reviewBypassed,
  downloadable,
}: {
  visibility?: string | null;
  teamNames?: string[] | null;
  reviewBypassed?: boolean | null;
  downloadable?: boolean | null;
}) {
  const restricted = visibility === "restricted";
  const previewOnly = downloadable === false;
  if (!restricted && !reviewBypassed && !previewOnly) return null;
  const teams = teamNames?.length ? teamNames.join(", ") : null;
  return (
    <>
      {restricted && (
        <Badge
          variant="accent"
          icon={<Lock className="h-3 w-3" aria-hidden />}
          tooltip={`${teams ? `Only visible to: ${teams}` : "Only visible to selected teams"}. Can't be shared outside the company.`}
        >
          {teams ? `${teams} only` : "Team only"}
        </Badge>
      )}
      {previewOnly && (
        <Badge variant="neutral" icon={<EyeOff className="h-3 w-3" aria-hidden />} tooltip="Can be viewed but not downloaded">
          Preview only
        </Badge>
      )}
      {reviewBypassed && (
        <Badge
          variant="warning"
          icon={<ShieldOff className="h-3 w-3" aria-hidden />}
          tooltip="Published by a manager without going through review"
        >
          Review Bypassed
        </Badge>
      )}
    </>
  );
}
