// Shared by every "set/reset a password directly" admin UI (InviteUserForm.tsx,
// ResetPasswordButton.tsx) — skips visually ambiguous characters (0/O,
// 1/l/I) since this is meant to be read off a screen and typed or
// copy-pasted somewhere else (Slack, a phone call), not stored back into a
// form. Browser-only (crypto.getRandomValues), never imported server-side.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}
