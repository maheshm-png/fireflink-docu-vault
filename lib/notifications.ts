import { prisma } from "./prisma";

/** Bulk-creates in-app notifications — see lib/notify.ts, which calls this
 * alongside the Google Chat send for the same event so both channels stay
 * in sync without every call site needing to know about both. Never
 * throws: a failed notification insert shouldn't fail the document action
 * that triggered it. */
export async function createNotifications(
  items: {
    userId: string;
    type: "published" | "revoked" | "new_version";
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
