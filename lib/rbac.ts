// Single source of truth for the role matrix. Both API routes and the UI
// import from here so permission logic never drifts between layers.
// The database RLS policies (prisma/rls_policies.sql) enforce the same
// rules independently — this file must not be the only line of defense.

export type Role = "superadmin" | "manager" | "contributor" | "user";

/** Full display names, shown anywhere a role reaches a person (e.g. the
 * Navbar's profile badge). */
export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin",
  manager: "Manager",
  contributor: "Contributor",
  user: "User",
};

export const PERMISSIONS = {
  viewPublished: ["superadmin", "manager", "contributor", "user"],
  upload: ["superadmin", "manager", "contributor"],
  editOwnUpload: ["superadmin", "manager", "contributor"],
  // Reviewing/approving is manager-only — deliberately excludes superadmin,
  // which otherwise has every other elevated permission.
  approveReview: ["manager"],
  revokeDocument: ["superadmin", "manager"],
  // Manager-only, deliberately excludes superadmin — same reasoning as
  // approveReview. The one exception (an uploader deleting their own
  // still-pending submission) is checked separately, alongside this, at the
  // call site (see app/api/documents/[id]/route.ts) rather than folded into
  // this role matrix, since it depends on document state/ownership, not role.
  deleteDocument: ["manager"],
  // Retiring (archive) or restoring (unarchive) a settled document —
  // same reviewer-tier scope as revokeDocument, since it's the same kind
  // of "take this out of/back into circulation" decision.
  archiveDocument: ["superadmin", "manager"],
  // Deliberately includes superadmin (unlike deleteDocument itself) — the
  // user asked specifically for both manager and superadmin to be able to
  // see and recover deleted documents, even though superadmin can't
  // initiate a delete.
  viewDeleted: ["superadmin", "manager"],
  restoreDocument: ["superadmin", "manager"],
  // Extending a document's validity, marking it permanent (no re-review),
  // and dismissing a false-positive duplicate flag — all manager-tier
  // document-lifecycle calls.
  manageDocumentLifecycle: ["superadmin", "manager"],
  manageSettings: ["superadmin", "manager"],
  manageCategories: ["superadmin", "manager"],
  // Posting/editing/holding/deleting the dashboard ticker's manager-authored
  // messages (components/AnnouncementTicker.tsx) — same tier as every other
  // org-wide broadcast surface in this app.
  manageAnnouncements: ["superadmin", "manager"],
  manageUsers: ["superadmin"],
  // The admin-managed designation option list (app/admin/designations) —
  // same tier as manageUsers since it's really a sub-concern of user
  // management (what designation a user can be assigned).
  manageDesignations: ["superadmin"],
  viewAuditLog: ["superadmin", "manager"],
} as const;

type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/** Throws a 403-style error object for use in API route handlers. */
export function assertCan(role: Role, permission: Permission) {
  if (!can(role, permission)) {
    const err: any = new Error(`Forbidden: role "${role}" cannot "${permission}"`);
    err.status = 403;
    throw err;
  }
}
