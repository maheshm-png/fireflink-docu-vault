import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 5;

// Service-role client — only ever used server-side, never shipped to the
// browser. Required to set a password directly by user id, bypassing
// Supabase Auth's own recovery-session flow entirely (this route already
// did its own verification against PasswordResetOtp above).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/reset-password — verify the OTP issued by
// /api/auth/forgot-password and apply the new password.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { password } = body;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  // Same normalising as forgot-password, so the code it sent is found.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !code || !password) {
    return NextResponse.json({ error: "Email, code, and new password are required." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const otp = await prisma.passwordResetOtp.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date()) {
    return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
  }
  // Every try is counted before the code is compared, in one conditional
  // update, so many guesses sent at once can't all slip in under the limit.
  const counted = await prisma.passwordResetOtp.updateMany({
    where: { id: otp.id, used: false, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) {
    return NextResponse.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 400 });
  }

  const expected = Buffer.from(otp.codeHash, "hex");
  const given = Buffer.from(hashCode(code), "hex");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  // Claim the code so it can only ever reset the password once.
  const claimed = await prisma.passwordResetOtp.updateMany({ where: { id: otp.id, used: false }, data: { used: true } });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "That code has already been used. Request a new one." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
  }

  // The person chose this password themselves via an emailed code, so any
  // must_change_password flag from an earlier admin-set one no longer applies.
  // updateUserById also THROWS (rather than returning an error) when user.id
  // isn't a valid UUID, so it's wrapped, and nothing here may escape as
  // Next's HTML 500 page. On failure the code is handed back, so a rejected
  // password (too weak) can be retried with the same code.
  const releaseCode = () => prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { used: false } }).catch(() => {});
  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      app_metadata: { must_change_password: false },
    });
    if (error) {
      await releaseCode();
      // A 4xx from Supabase is about the password itself (too weak, same as
      // the old one) and worth showing. Anything else is infrastructure, e.g.
      // an unreachable or misrouted Supabase URL, whose raw message ("Unexpected
      // token '<'...", from an HTML page) means nothing to the user.
      console.error(`reset-password: Supabase rejected the update for ${email}`, error);
      const userFacing = typeof error.status === "number" && error.status >= 400 && error.status < 500;
      return NextResponse.json(
        { error: userFacing ? error.message : "We couldn't reset this password. Please try again, or contact docuvault@fireflink.com." },
        { status: 500 }
      );
    }
  } catch (e) {
    await releaseCode();
    console.error(`reset-password: could not update auth user for ${email} (User.id=${user.id})`, e);
    return NextResponse.json(
      { error: "We couldn't reset this password. Please contact docuvault@fireflink.com." },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Password updated." });
}
