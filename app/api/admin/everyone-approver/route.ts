import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// PUT /api/admin/everyone-approver — { userId: string | null }
// Superadmin picks the one Global approver (User.isGlobalApprover), an
// active org manager who decides every team's "Request for Everyone"
// (lib/access.ts decidesEveryoneRequests). null clears it.
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can choose the Global approver." }, { status: 403 });
  }

  const { userId } = await req.json().catch(() => ({ userId: undefined }));
  if (userId !== null && typeof userId !== "string") {
    return NextResponse.json({ error: "userId must be a user id or null." }, { status: 400 });
  }
  if (userId) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
    if (!target || !target.isActive || target.role !== "manager") {
      return NextResponse.json({ error: "The Global approver must be an active manager." }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.user.updateMany({ where: { isGlobalApprover: true, ...(userId ? { id: { not: userId } } : {}) }, data: { isGlobalApprover: false } }),
    ...(userId ? [prisma.user.update({ where: { id: userId }, data: { isGlobalApprover: true } })] : []),
  ]);
  await logAudit({ userId: user.id, action: "global_approver_change" });

  return NextResponse.json({ ok: true });
}
