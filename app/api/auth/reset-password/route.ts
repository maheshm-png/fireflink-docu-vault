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
  const { email, code, password } = await req.json();
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
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 400 });
  }

  if (hashCode(code) !== otp.codeHash) {
    await prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
  }

  // The person chose this password themselves via an emailed code, so any
  // must_change_password flag from an earlier admin-set one no longer applies.
  // updateUserById also THROWS (rather than returning an error) when user.id
  // isn't a valid UUID, so it's wrapped, and nothing here may escape as
  // Next's HTML 500 page.
  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      app_metadata: { must_change_password: false },
    });
    if (error) {
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
    console.error(`reset-password: could not update auth user for ${email} (User.id=${user.id})`, e);
    return NextResponse.json(
      { error: "We couldn't reset this password. Please contact docuvault@fireflink.com." },
      { status: 500 }
    );
  }

  await prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { used: true } });

  return NextResponse.json({ message: "Password updated." });
}
