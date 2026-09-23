import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { fireNotification } from "@/lib/notify";

const OTP_TTL_MINUTES = 10;
// Below this age, a repeat request for the same email is treated as a
// double-click/resend-mash rather than a genuine new request — reuses
// whatever code is already outstanding instead of invalidating it and
// sending another email.
const RESEND_COOLDOWN_MS = 30_000;

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// POST /api/auth/forgot-password — request an OTP code to reset a
// forgotten password. Tells the caller outright when the email isn't linked
// to any account (per product decision — this trades away the usual
// anti-enumeration protection of a generic response, so an unknown email is
// reported explicitly instead of silently no-op'ing behind a generic
// message).
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  const genericResponse = () =>
    NextResponse.json({
      message: "If that email belongs to an account, a verification code has been sent.",
    });

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Enter an email address." }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "This email isn't linked to any account." }, { status: 404 });
  }

  const recent = await prisma.passwordResetOtp.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return genericResponse();
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

  // Only one live code per email at a time — a fresh request supersedes
  // whatever was issued before rather than leaving multiple valid codes
  // outstanding. Both writes run in one transaction so two near-simultaneous
  // requests for the same email can't each create a code the other's delete
  // missed.
  await prisma.$transaction([
    prisma.passwordResetOtp.deleteMany({ where: { email, used: false } }),
    prisma.passwordResetOtp.create({
      data: {
        email,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  fireNotification(
    sendEmail({
      to: email,
      subject: "Your FireFlink Docu Vault password reset code",
      html: `
        <p>Hello ${user.name},</p>
        <p>Use the code below to verify your identity and set a new password. This code expires in ${OTP_TTL_MINUTES} minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${code}</p>
        <p>If you didn't request this, you can ignore this email, your password won't change unless this code is used.</p>
      `,
    })
  );

  return genericResponse();
}
