import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 24 * 90; // 90 days

// Anyone active who can reach the document detail page at all can share it
// — same audience as Preview/Download there, which don't check role either
// (see app/dashboard/documents/[id]/page.tsx: those render unconditionally
// for any signed-in user, including the base "user" view-only role). The
// only real restriction is that a soft-deleted document isn't shareable.
async function assertCanManageShare(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { deletedAt: true },
  });
  if (!document || document.deletedAt) return false;
  return true;
}

// GET /api/documents/:id/share — current share link status, if any.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertCanManageShare(params.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const share = await prisma.shareLink.findUnique({ where: { documentId: params.id } });
  if (!share) return NextResponse.json({ share: null });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.json({
    share: {
      url: `${appUrl}/share/${share.token}`,
      accessLevel: share.accessLevel,
      expiresAt: share.expiresAt,
      expired: share.expiresAt !== null && share.expiresAt.getTime() < Date.now(),
    },
  });
}

// POST /api/documents/:id/share — { accessLevel: "view"|"view_download", expiresInHours: number | null }
// Creates the share link if none exists yet, otherwise updates the existing
// one's access level and expiry in place — the token (and therefore any
// copy of the URL already handed out) keeps working, just with whatever the
// new settings are. expiresInHours: null means "No expiry" — the link never
// expires on its own (still removable any time via DELETE below).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertCanManageShare(params.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { accessLevel, expiresInHours } = body;
  if (!["view", "view_download"].includes(accessLevel)) {
    return NextResponse.json({ error: "Invalid access level" }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (expiresInHours !== null) {
    const hours = Number(expiresInHours);
    if (!Number.isFinite(hours) || hours < MIN_EXPIRY_HOURS || hours > MAX_EXPIRY_HOURS) {
      return NextResponse.json(
        { error: `Expiry must be between ${MIN_EXPIRY_HOURS} hour and ${MAX_EXPIRY_HOURS / 24} days, or no expiry.` },
        { status: 400 }
      );
    }
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  const document = await prisma.document.findUniqueOrThrow({ where: { id: params.id } });

  const share = await prisma.shareLink.upsert({
    where: { documentId: params.id },
    create: { documentId: params.id, accessLevel, expiresAt, createdById: user.id },
    update: { accessLevel, expiresAt },
  });

  await logAudit({ userId: user.id, action: "edit", documentId: document.id, documentTitle: document.title });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.json({
    share: {
      url: `${appUrl}/share/${share.token}`,
      accessLevel: share.accessLevel,
      expiresAt: share.expiresAt,
      expired: false,
    },
  });
}

// DELETE /api/documents/:id/share — stop sharing entirely.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await assertCanManageShare(params.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  await prisma.shareLink.deleteMany({ where: { documentId: params.id } });
  if (document) {
    await logAudit({ userId: user.id, action: "edit", documentId: document.id, documentTitle: document.title });
  }

  return NextResponse.json({ ok: true });
}
