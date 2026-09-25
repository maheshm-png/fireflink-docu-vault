import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { withoutDeletedDocuments } from "@/lib/notifications";

// GET /api/notifications — the current user's most recent notifications
// plus their unread count, for the bell panel (components/NotificationBell.tsx).
// Polled client-side rather than pushed, since this app has no websocket/SSE
// infra — see NotificationBell's poll interval.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Over-fetches before trimming to 30 so notifications about since-deleted
  // documents (dropped below) don't leave the panel short.
  const [recent, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.notification.findMany({ where: { userId: user.id, read: false }, select: { documentId: true } }),
  ]);
  const [notifications, liveUnread] = await Promise.all([withoutDeletedDocuments(recent), withoutDeletedDocuments(unread)]);

  return NextResponse.json({ notifications: notifications.slice(0, 30), unreadCount: liveUnread.length });
}
