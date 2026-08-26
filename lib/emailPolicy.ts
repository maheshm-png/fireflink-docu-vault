/**
 * Restricts who can be invited to only company email addresses, so the
 * superadmin can't accidentally (or a compromised session can't) add an
 * outside address. Configure via ALLOWED_EMAIL_DOMAINS (comma-separated,
 * e.g. "fireflink.com,fireflink.io"). If unset, falls back to fireflink.com.
 */
export function getAllowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS || "fireflink.com";
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return getAllowedEmailDomains().includes(domain);
}
