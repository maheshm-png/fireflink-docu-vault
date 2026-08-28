import { headers } from "next/headers";
import { prisma } from "./prisma";

// `ipAddress` was a scaffolded param nothing ever actually passed — every
// audit log entry showed a blank IP column regardless of environment.
// `headers()` works from any function called during a request (route
// handlers, server components), not just the route file itself, so this
// derives it centrally instead of threading it through 25 call sites.
// Needs a reverse proxy (like the `caddy` service) setting X-Forwarded-For
// in front of the app to have a value at all — direct, unproxied access
// has no such header, and this correctly stays blank in that case.
function getClientIp(): string | undefined {
  const h = headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return h.get("x-real-ip") ?? undefined;
}

export type AuditAction =
  | "upload" | "approve" | "reject" | "delete"
  | "download" | "login" | "role_change" | "edit" | "revoke"
  | "archive" | "unarchive" | "restore" | "purge"
  | "extend_validity" | "toggle_permanent" | "dismiss_duplicate" | "set_current_version"
  | "post_announcement" | "edit_announcement" | "hold_announcement" | "resume_announcement" | "delete_announcement"
  | "reassign_review" | "request_second_opinion" | "undo_approval"
  | "remove_user" | "restore_user";

export async function logAudit(params: {
  userId: string;
  action: AuditAction;
  documentId?: string;
  // Snapshotted, not looked up later — see the schema comment on
  // AuditLog.documentTitle. Always pass this when documentId is set.
  documentTitle?: string;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      documentId: params.documentId,
      documentTitle: params.documentTitle,
      ipAddress: params.ipAddress ?? getClientIp(),
    },
  });
}
