import nodemailer from "nodemailer";

/**
 * App-level transactional email (invite/decision/new-version alerts) —
 * separate from Supabase Auth's own SMTP config, which lives in the
 * self-hosted Supabase stack and only covers Supabase's own emails
 * (invite-user, password reset). This is a different SMTP account/config,
 * even if in practice it ends up being the same mailbox.
 *
 * Same no-op-if-unconfigured philosophy as lib/gchat.ts: an unset
 * SMTP_HOST means email sends silently do nothing rather than crash the
 * request that triggered them (an approval/upload/etc. shouldn't fail
 * just because a notification couldn't go out).
 */
let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return cachedTransporter;
}

export async function sendEmail(params: { to: string; subject: string; html: string }) {
  const transporter = getTransporter();
  if (!transporter) return; // no-op until SMTP_HOST is configured

  const fromName = process.env.SMTP_FROM_NAME || "FireFlink Docu Vault";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  } catch (err) {
    console.error(`Email send failed (to ${params.to}, subject "${params.subject}"):`, err);
  }
}
