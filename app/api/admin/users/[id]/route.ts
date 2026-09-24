import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan, type Role } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const VALID_ROLES: Role[] = ["superadmin", "manager", "contributor", "user"];
const MIN_PASSWORD_LENGTH = 8;

// Service-role client — only ever used server-side, never shipped to the
// browser. Required to reset another user's password directly (below),
// same as app/api/admin/users/route.ts's own createUser/generateLink calls.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  const { role, designationId, teamId, reportsToId, isActive, password } = await req.json();
  const data: Prisma.UserUncheckedUpdateInput = {};

  // Resets this user's Supabase Auth credential directly, same "set it
  // yourself, hand it over yourself" escape hatch as InviteUserForm.tsx's
  // "Set Password Directly" mode at add-time, now available any time after
  // too — for a currently-active user whose forgot-password email isn't
  // arriving, or who just wants a fresh password from an admin rather than
  // going through the self-service OTP flow. Independent of every other
  // field below: it's a direct Supabase Auth call, not part of the Prisma
  // `data` update, and doesn't require touching role/designation/etc. in
  // the same request.
  let passwordWasReset = false;
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }
    // An admin knows this password, so the user must pick their own at next
    // sign-in (enforced by middleware.ts, cleared by /api/auth/set-password).
    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
      password,
      app_metadata: { must_change_password: true },
    });
    if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });
    await logAudit({ userId: user.id, action: "reset_password", documentId: undefined });
    passwordWasReset = true;
  }

  if (role !== undefined) {
    if (params.id === user.id) {
      return NextResponse.json({ error: "You can't change your own role, ask another superadmin." }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    data.role = role as Role;
  }

  if (isActive !== undefined) {
    if (params.id === user.id) {
      return NextResponse.json({ error: "You can't remove your own account, ask another superadmin." }, { status: 400 });
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

  if (teamId !== undefined) {
    if (teamId !== null) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return NextResponse.json({ error: "That team doesn't exist." }, { status: 400 });
    }
    data.teamId = teamId;
  }

  if (reportsToId !== undefined) {
    if (reportsToId === params.id) {
      return NextResponse.json({ error: "A user can't report to themselves." }, { status: 400 });
    }
    if (reportsToId !== null) {
      // Not restricted to role "manager"/"superadmin" — some people who
      // functionally manage a team are tagged a different role for
      // permission reasons that don't reflect the org chart. See
      // app/admin/users/page.tsx's own comment on reportsToOptions.
      const manager = await prisma.user.findUnique({ where: { id: reportsToId } });
      if (!manager || !manager.isActive) {
        return NextResponse.json({ error: "reportsToId must be an existing, active user." }, { status: 400 });
      }
    }
    data.reportsToId = reportsToId;
  }

  if (Object.keys(data).length === 0) {
    // A password-only request never touches `data` above (it's a direct
    // Supabase Auth call, not a Prisma field) — already applied by this
    // point, so this isn't actually "nothing to update," just nothing left
    // for Prisma to do.
    if (passwordWasReset) {
      return NextResponse.json({
        ok: true,
        role: target.role,
        designationId: target.designationId,
        teamId: target.teamId,
        reportsToId: target.reportsToId,
        isActive: target.isActive,
      });
    }
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
    teamId: updated.teamId,
    reportsToId: updated.reportsToId,
    isActive: updated.isActive,
  });
}
