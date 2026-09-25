import { prisma } from "./prisma";

/** Bulk-creates in-app notifications — see lib/notify.ts, which calls this
 * alongside the Google Chat send for the same event so both channels stay
 * in sync without every call site needing to know about both. Never
 * throws: a failed notification insert shouldn't fail the document action
 * that triggered it. */
export async function createNotifications(
  items: {
    userId: string;
    type: "published" | "revoked" | "new_version" | "approved" | "rejected" | "feedback_accepted" | "feedback_tagged" | "feedback_replied";
    title: string;
    body?: string;
    documentId?: string;
    documentTitle?: string;
  }[]
) {
  if (items.length === 0) return;
  try {
    await prisma.notification.createMany({ data: items });
  } catch (err) {
    console.error("Failed to create in-app notifications:", err);
  }
}

/** Drops notifications whose document has since been deleted (soft-deleted
 * or purged). Notification has no FK to Document, so without this a
 * deleted document kept showing in the bell, the "New" ticker and the NEW
 * badges. Filtered at read time rather than deleting rows, so restoring a
 * document within its retention window brings its notifications back. */
export async function withoutDeletedDocuments<T extends { documentId: string | null }>(items: T[]): Promise<T[]> {
  const ids = [...new Set(items.map((n) => n.documentId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return items;
  const live = await prisma.document.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  const liveIds = new Set(live.map((d) => d.id));
  return items.filter((n) => n.documentId === null || liveIds.has(n.documentId));
}
