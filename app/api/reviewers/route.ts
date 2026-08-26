import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// Any active, logged-in user can call this — they need it to pick who
// reviews their upload, and a reviewer needs it to reassign/add a co-
// reviewer (see app/api/documents/[id]/review/route.ts). Only ever returns
// managers (the only role that can approve/reject — see approveReview in
// lib/rbac.ts), never the full user list (that stays behind
// /api/admin/users, superadmin-only) — and never the caller themselves,
// since nobody can pick themselves as their own reviewer.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reviewers = await prisma.user.findMany({
    where: { isActive: true, role: "manager", id: { not: user.id } },
    select: { id: true, name: true, role: true, reportsToId: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(reviewers);
}
