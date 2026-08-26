import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan, type Role } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const VALID_ROLES: Role[] = ["superadmin", "manager", "contributor", "user"];

// PATCH /api/admin/users/:id — superadmin edits another user's role,
// designation, and/or reporting manager (any subset of the three, in one
// call). Role changes on your own account are still blocked — a superadmin
// can't accidentally lock themselves out, another superadmin has to do it —
// but designation/reportsTo aren't security-sensitive the same way, so
// those two are allowed on your own account too.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageUsers");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const target = await prisma.user.findUniqueOrThrow({ where: { id: params.id } });
  const { role, designationId, reportsToId, isActive } = await req.json();
  const data: Prisma.UserUncheckedUpdateInput = {};

  if (role !== undefined) {
    if (params.id === user.id) {
      return NextResponse.json({ error: "You can't change your own role — ask another superadmin." }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    data.role = role as Role;
  }

  if (isActive !== undefined) {
    if (params.id === user.id) {
      return NextResponse.json({ error: "You can't remove your own account — ask another superadmin." }, { status: 400 });
    }
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
    }
    // Removing (deactivating) a user logs them out immediately (see
    // getCurrentUser's isActive check), which would strand any document
    // waiting on their decision forever — reassignment is self-service only
    // (a reviewer hands off their OWN pending row; there's no admin-side
    // override), so once they're deactivated nobody could ever move it off
    // their queue again. Blocking removal here forces reassigning first,
    // while they can still act on it.
    if (isActive === false) {
      const pendingReviewCount = await prisma.reviewRequest.count({
        where: { reviewerId: params.id, status: "pending" },
      });
      if (pendingReviewCount > 0) {
        return NextResponse.json(
          {
            error: `This person has ${pendingReviewCount} pending review${pendingReviewCount === 1 ? "" : "s"} assigned. Have them reassign or decide those first, then remove them.`,
          },
          { status: 400 }
        );
      }
    }
    data.isActive = isActive;
  }

  if (designationId !== undefined) {
    if (designationId !== null) {
      const designation = await prisma.designation.findUnique({ where: { id: designationId } });
      if (!designation) return NextResponse.json({ error: "That designation doesn't exist." }, { status: 400 });
    }
    data.designationId = designationId;
  }

  if (reportsToId !== undefined) {
    if (reportsToId === params.id) {
      return NextResponse.json({ error: "A user can't report to themselves." }, { status: 400 });
    }
    if (reportsToId !== null) {
      const manager = await prisma.user.findUnique({ where: { id: reportsToId } });
      if (!manager || !manager.isActive || (manager.role !== "manager" && manager.role !== "superadmin")) {
        return NextResponse.json({ error: "reportsToId must be an existing, active manager or superadmin." }, { status: 400 });
      }
    }
    data.reportsToId = reportsToId;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data });

  if (data.role !== undefined) {
    await logAudit({ userId: user.id, action: "role_change", documentId: undefined });
  }
  if (data.isActive !== undefined) {
    await logAudit({ userId: user.id, action: data.isActive ? "restore_user" : "remove_user", documentId: undefined });
  }

  return NextResponse.json({
    ok: true,
    role: updated.role,
    designationId: updated.designationId,
    reportsToId: updated.reportsToId,
    isActive: updated.isActive,
  });
}
