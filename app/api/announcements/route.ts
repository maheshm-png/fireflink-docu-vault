import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// GET /api/announcements — feeds the dashboard ticker (components/
// AnnouncementTicker.tsx) only. Always active-only, for every caller
// including a manager/superadmin viewing their own dashboard — a held
// message must disappear for the person who held it too, not just everyone
// else. (The admin management page at /admin/announcements reads every
// announcement, held ones included, but does so via a direct Prisma query
// in its own server component, not this route — see app/admin/
// announcements/page.tsx — precisely so this endpoint can stay
// unconditionally active-only.)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const announcements = await prisma.announcement.findMany({
    where: { isActive: true },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(announcements);
}

// POST /api/announcements — manager/superadmin posts a new message to the
// dashboard ticker. Starts active immediately (no separate "publish" step —
// this is a lightweight broadcast, not a reviewed document).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageAnnouncements");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { message } = await req.json();
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > 300) {
    return NextResponse.json({ error: "Keep it under 300 characters — this scrolls in a single line." }, { status: 400 });
  }

  const announcement = await prisma.announcement.create({
    data: { message: message.trim(), createdById: user.id },
    include: { createdBy: { select: { name: true } } },
  });

  await logAudit({ userId: user.id, action: "post_announcement", documentId: undefined });

  return NextResponse.json(announcement, { status: 201 });
}
