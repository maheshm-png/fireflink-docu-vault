import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { isAllowedEmailDomain, getAllowedEmailDomains } from "@/lib/emailPolicy";
import { sendEmail } from "@/lib/email";
import { fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// Service-role client — only ever used server-side, never shipped to the browser.
// Required to create auth users programmatically (invite flow).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// The public origin this request came in on (Caddy sets X-Forwarded-*), so an
// invite link points at wherever the admin is actually using the app even if
// NEXT_PUBLIC_APP_URL was baked into the build wrong. Only a signed-in
// superadmin can reach the code that uses this.
function requestOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (!host) return APP_URL;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageUsers");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(users);
}

const MIN_PASSWORD_LENGTH = 8;

// POST /api/admin/users — superadmin adds a new user by email + role.
// Two ways in, chosen by whether `password` is present in the body:
//   - Omitted (default, InviteUserForm.tsx's "Send Email Invite" mode):
//     sends a Supabase magic-link invite; the user sets their own password
//     from that email.
//   - Provided (the "Set Password Directly" mode, for when that invite
//     email never arrives, e.g. Supabase's own SMTP config being down or
//     misconfigured, or just landing in spam): creates the account with
//     that password immediately, `email_confirm: true` skipping Supabase's
//     own confirmation email entirely, so the person can sign in right away
//     with whatever the admin hands them directly (Slack, in person, phone)
//     without either of them ever touching the database.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageUsers");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { email, name, role, password } = await req.json();
  if (!email || !name || !role) {
    return NextResponse.json({ error: "email, name, and role are required" }, { status: 400 });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH)) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  if (!isAllowedEmailDomain(email)) {
    return NextResponse.json(
      {
        error: `Only ${getAllowedEmailDomains().map((d) => "@" + d).join(" or ")} email addresses can be added.`,
      },
      { status: 400 }
    );
  }

  // An email already belonging to an ACTIVE user is a real duplicate.
  // One belonging to a previously-removed (isActive: false) user isn't —
  // "remove" is a soft deactivate (see PATCH .../users/[id]'s isActive
  // branch), so that row, its Supabase Auth account, and every document
  // they've ever uploaded/owned/reviewed are all still intact under the
  // same User.id. Re-adding them here reactivates that same row instead of
  // trying to create a brand-new one — which would otherwise either hit
  // Prisma's unique-email constraint, or, worse, succeed with a different
  // id and silently orphan their entire upload/review/dashboard history
  // onto an account nothing points at anymore.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.isActive) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
    // A password provided while reactivating also resets their Supabase
    // Auth credential to it — the same "set it directly, hand it over
    // yourself" escape hatch applies to bringing someone back, not just a
    // first-time add.
    if (password) {
      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        app_metadata: { must_change_password: true },
      });
      if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });
    }
    const reactivated = await prisma.user.update({
      where: { id: existing.id },
      data: { name, role, isActive: true },
    });
    await logAudit({ userId: user.id, action: "restore_user", documentId: undefined });
    return NextResponse.json({ user: reactivated }, { status: 200 });
  }

  // Email-invite mode deliberately never calls inviteUserByEmail — that
  // sends its own email through Supabase Auth's own SMTP config (the
  // self-hosted Supabase stack's, entirely separate from and unrelated to
  // this app's own docuvault@fireflink.com setup in lib/email.ts). Using
  // generateLink instead creates the same invited user and returns the
  // same kind of action_link WITHOUT Supabase sending anything itself —
  // this app then emails that link out through its own SMTP below, so
  // every outbound email this app is responsible for goes through one
  // config, one mailbox, one place to debug when it doesn't arrive.
  let actionLink: string | null = null;
  let invitedUserId: string;
  if (password) {
    // must_change_password (app_metadata, so only this service-role client can
    // set or clear it) makes middleware.ts hold the user on /accept-invite
    // until they replace this admin-chosen password with their own.
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invitedUserId = created.user.id;
  } else {
    const { data: generated, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invitedUserId = generated.user.id;
    // Deliberately not generated.properties.action_link: that URL is built by
    // Supabase from its own API_EXTERNAL_URL / SITE_URL settings (a
    // self-hosted stack ships with localhost defaults) and only honors our
    // redirect if it's in its allow-list. Sending the one-time token straight
    // to /accept-invite, which exchanges it via verifyOtp, depends on neither.
    actionLink = `${requestOrigin(req)}/accept-invite?token_hash=${encodeURIComponent(
      generated.properties.hashed_token
    )}&type=invite`;
    // The invite link signs them in with no password set yet, so without this
    // flag they could skip /accept-invite and browse straight to the app.
    const { error: flagError } = await supabaseAdmin.auth.admin.updateUserById(invitedUserId, {
      app_metadata: { must_change_password: true },
    });
    if (flagError) {
      // Don't leave an unflagged, unrecorded auth user behind for a retry to trip over.
      await supabaseAdmin.auth.admin.deleteUser(invitedUserId);
      return NextResponse.json({ error: flagError.message }, { status: 500 });
    }
  }

  const newUser = await prisma.user.create({
    data: {
      id: invitedUserId,
      email,
      name,
      role,
      passwordHash: "", // Supabase Auth owns the credential; not stored here
    },
  });

  if (actionLink) {
    fireNotification(
      sendEmail({
        to: email,
        subject: "You've been invited to FireFlink Docu Vault",
        html: `
          <p>Hello ${name},</p>
          <p>You've been invited to FireFlink Docu Vault. Use the link below to set your password and sign in.</p>
          <p><a href="${actionLink}">Accept Invite &amp; Set Password</a></p>
          <p>If you weren't expecting this, you can ignore this email.</p>
        `,
      })
    );
  }

  await logAudit({ userId: user.id, action: "role_change", documentId: undefined });

  return NextResponse.json({ user: newUser }, { status: 201 });
}
