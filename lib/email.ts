import nodemailer from "nodemailer";
import { notifyGChatManager } from "./gchat";

/**
 * App-level transactional email (invite/decision/new-version alerts,
 * password-reset OTPs) — separate from Supabase Auth's own SMTP config,
 * which lives in the self-hosted Supabase stack and only covers Supabase's
 * own emails. This is a different SMTP account/config, even if in practice
 * it ends up being the same mailbox (docuvault@fireflink.com).
 *
 * Plain SMTP via nodemailer, authenticated with a Gmail App Password
 * (myaccount.google.com/apppasswords on the docuvault@fireflink.com
 * account, once 2-Step Verification is turned on for it) rather than an
 * OAuth2 refresh token — no Google Cloud OAuth consent screen, no
 * verification review, no Workspace admin/domain-wide-delegation approval,
 * and no 7-day expiry to babysit. An App Password is a long-lived
 * credential: it works until it's manually revoked or the account's
 * password changes, not on any fixed schedule.
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

/**
 * Consistent formal letterhead/signature for every outgoing email — callers
 * (lib/notify.ts) only supply the body content, so every notification reads
 * as one official, consistent piece of correspondence rather than each
 * being separately (and inconsistently) formatted.
 */
function renderFormalEmail(bodyHtml: string) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <div style="padding: 20px 0; border-bottom: 2px solid #5b2a86;">
        <span style="font-size: 18px; font-weight: bold; color: #5b2a86;">FireFlink Docu Vault</span>
      </div>
      <div style="padding: 24px 0; font-size: 14px; line-height: 1.6;">
        ${bodyHtml}
      </div>
      <div style="padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666666;">
        <p>Regards,<br/>FireFlink Docu Vault Team</p>
        <p>This is an automated notification. Please do not reply to this email.</p>
      </div>
    </div>
  `;
}

// nodemailer sets `.code` to "EAUTH" specifically for a rejected
// username/password (a revoked or rotated App Password, 2-Step
// Verification turned off on the account, etc.) — the one failure mode
// here that actually needs a human to act (mint a new App Password and
// update SMTP_PASS) rather than just retry on its own. Every other code
// (ECONNECTION, ETIMEDOUT, ...) is a transient network hiccup worth
// leaving to retry on the next notification rather than paging anyone.
function isAuthError(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === "EAUTH";
}

// Every notification email attempt fails identically once the App Password
// has actually been revoked/rotated without updating SMTP_PASS — without
// this, a single busy day (several approvals/uploads) would post the same
// "email is broken" alert to the manager Chat space that many times. One
// alert per cold start is enough to get someone to act; process restarts
// (a deploy, a crash recovery) are the only time this repeats, which is an
// acceptable/rare re-notify.
let hasAlertedForAuthFailure = false;

/**
 * Everything in here is wrapped in one try/catch, including getTransporter()
 * — a malformed SMTP_* value (e.g. a non-numeric SMTP_PORT) can make
 * nodemailer.createTransport() throw synchronously, and this function is
 * awaited directly from upload/approve/reject routes with no try/catch of
 * their own. Letting anything here escape would turn a bad email config
 * into those core actions failing outright, not just the notification.
 */
export async function sendEmail(params: { to: string; subject: string; html: string }) {
  try {
    const transporter = getTransporter();
    if (!transporter) return; // no-op until SMTP_HOST is configured

    const fromName = process.env.SMTP_FROM_NAME || "FireFlink Docu Vault";
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: renderFormalEmail(params.html),
    });
  } catch (err) {
    console.error(`Email send failed (to ${params.to}, subject "${params.subject}"):`, err);
    if (isAuthError(err) && !hasAlertedForAuthFailure) {
      hasAlertedForAuthFailure = true;
      await notifyGChatManager(
        [
          "Action required: document notification emails have stopped",
          "",
          "SMTP authentication failed (SMTP_USER/SMTP_PASS rejected) — the Gmail App Password may have been revoked or rotated.",
          "Generate a new one at https://myaccount.google.com/apppasswords on the sending account, then update SMTP_PASS and restart the app.",
        ].join("\n")
      );
    }
  }
}
