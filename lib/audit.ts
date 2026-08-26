import { prisma } from "./prisma";

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
      ipAddress: params.ipAddress,
    },
  });
}
