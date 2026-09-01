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
  }
}
