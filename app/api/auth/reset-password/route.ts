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

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await prisma.passwordResetOtp.update({ where: { id: otp.id }, data: { used: true } });

  return NextResponse.json({ message: "Password updated." });
}
