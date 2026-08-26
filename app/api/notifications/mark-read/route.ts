import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// POST /api/notifications/mark-read — body: { id: string } to mark one, or
// { all: true } to clear every unread notification for the current user.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, all } = await req.json();

  if (all) {
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: "id or all is required" }, { status: 400 });

  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
