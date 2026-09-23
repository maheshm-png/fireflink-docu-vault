import { md5 } from "./md5";

// Gravatar's own protocol: MD5 of the trimmed, lowercased email address as
// the lookup key — not a security hash, just what that (decade-old, still
// widely used) service requires. This is the only email-addressable photo
// source available with no extra setup: pulling an actual Google
// Workspace profile photo would need the org's admin to grant a service
// account domain-wide delegation for the People API, which is an infra
// decision outside this app, not something derivable from just an email
// address. `d=404` makes a request for an address with no Gravatar set up
// return a real 404 (handled by components/Avatar.tsx's onError fallback
// to the existing initials circle) instead of Gravatar's own generic
// silhouette placeholder.
export function gravatarUrl(email: string, size = 64): string {
  const hash = md5(email.trim().toLowerCase());
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}
