import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// Any active, logged-in user can call this — they need it to pick who
// reviews their upload, and a reviewer needs it to reassign/add a co-
// reviewer (see app/api/documents/[id]/review/route.ts). Only ever returns
// people who can review something: org managers (Everyone documents) and
// team managers (their team's documents, whatever their org role), never the
// full user list (that stays behind /api/admin/users, superadmin-only), and
// never the caller themselves, since nobody can review their own upload.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reviewers = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: user.id },
      OR: [{ role: "manager" }, { teamMemberships: { some: { role: "manager" } } }],
    },
    select: {
      id: true,
      name: true,
      role: true,
      reportsToId: true,
      isGlobalApprover: true,
      teamMemberships: { where: { role: "manager" }, select: { teamId: true } },
    },
    orderBy: { name: "asc" },
  });
  // isOrgManager / teamIds (the teams they manage) let the forms offer only
  // people who may review the document at hand (lib/reviewerOptions.ts,
  // mirroring lib/access.ts's eligibleReviewerWhere, which the routes
  // enforce server-side as well).
  return NextResponse.json(
    reviewers.map(({ teamMemberships, ...r }) => ({
      ...r,
      isOrgManager: r.role === "manager",
      // The Global approver (always an org manager) may review any team's document.
      isGlobalApprover: r.isGlobalApprover && r.role === "manager",
      teamIds: teamMemberships.map((m) => m.teamId),
    }))
  );
}
