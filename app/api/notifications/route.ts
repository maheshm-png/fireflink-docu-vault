import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// GET /api/notifications — the current user's most recent notifications
// plus their unread count, for the bell panel (components/NotificationBell.tsx).
// Polled client-side rather than pushed, since this app has no websocket/SSE
// infra — see NotificationBell's poll interval.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
