// Client-safe filter for the /api/reviewers list: who may review a document
// with this visibility. Mirrors lib/access.ts's eligibleReviewerWhere (the
// server-side rule): Everyone documents go to org managers, team documents
// to managers of one of their teams or the Global approver (any team).
export type ReviewerOption = {
  id: string;
  name: string;
  role: string;
  reportsToId?: string | null;
  isOrgManager: boolean;
  // The one Global approver: may review any team's document.
  isGlobalApprover?: boolean;
  teamIds: string[];
};

export function reviewersFor<T extends ReviewerOption>(
  all: T[],
  visibility: "org" | "restricted",
  teamIds: string[]
): T[] {
  if (visibility === "restricted") {
    return all.filter((r) => r.teamIds.some((t) => teamIds.includes(t)) || r.isGlobalApprover);
  }
  return all.filter((r) => r.isOrgManager);
}
