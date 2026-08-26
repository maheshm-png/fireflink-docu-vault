import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// PATCH /api/announcements/:id — body: { message?: string, isActive?: boolean }
// Edit the text and/or hold (isActive: false) / resume (isActive: true) a
// message. Either field can be sent alone or together.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageAnnouncements");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { message, isActive } = await req.json();
  const data: { message?: string; isActive?: boolean } = {};

  if (message !== undefined) {
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
    }
    if (message.length > 300) {
      return NextResponse.json({ error: "Keep it under 300 characters — this scrolls in a single line." }, { status: 400 });
    }
    data.message = message.trim();
  }
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
    }
    data.isActive = isActive;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const existing = await prisma.announcement.findUniqueOrThrow({ where: { id: params.id } });
  const announcement = await prisma.announcement.update({
    where: { id: params.id },
    data,
    include: { createdBy: { select: { name: true } } },
  });

  if (data.message !== undefined) {
    await logAudit({ userId: user.id, action: "edit_announcement", documentId: undefined });
  }
  if (data.isActive !== undefined && data.isActive !== existing.isActive) {
    await logAudit({ userId: user.id, action: data.isActive ? "resume_announcement" : "hold_announcement", documentId: undefined });
  }

  return NextResponse.json(announcement);
}

// DELETE /api/announcements/:id — permanent removal, unlike "hold" (isActive:
// false via PATCH), which just pauses it without losing the message.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageAnnouncements");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  await prisma.announcement.delete({ where: { id: params.id } });
  await logAudit({ userId: user.id, action: "delete_announcement", documentId: undefined });

  return NextResponse.json({ ok: true });
}
