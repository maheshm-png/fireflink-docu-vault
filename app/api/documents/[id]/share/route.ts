import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import { prisma } from "@/lib/prisma";

const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 24 * 90; // 90 days

// Anyone active who can reach the document detail page at all can share it
// — same audience as Preview/Download there, which don't check role either
// (see app/dashboard/documents/[id]/page.tsx: those render unconditionally
// for any signed-in user, including the base "user" view-only role). What
// gets shared is always document.currentVersionId — there's no per-version
// share link, so a base user sharing "the document" and a manager sharing
// it both always hand out the same current version, never an older one.
// Beyond that, a document must actually have something approved to hand out:
// - Soft-deleted: never shareable.
// - A normal (non-link) document: currentVersionId is only ever set for
//   real by an actual approval (app/api/documents/[id]/review/route.ts) —
//   a fresh upload no longer gets one prematurely at creation. This also
//   correctly still allows sharing an already-published document's
//   last-approved version while a newer replacement is separately pending
//   review (currentVersionId keeps pointing at the old, still-valid one
//   until the new one is itself approved). It's re-verified against
//   everApprovedVersionIds rather than trusting currentVersionId !== null
//   on its own, since a document created before that creation-time bug was
//   fixed can still have a stale currentVersionId left over from it,
//   pointing at a version that was actually rejected.
// - A legacy externalUrl ("link") document: has no versions/currentVersionId
//   at all even once approved, so status itself is the only signal.
// Re-checked here (not just by hiding the Share button in the UI) since a
// direct API call would otherwise bypass it.
async function assertCanManageShare(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      deletedAt: true,
      externalUrl: true,
      status: true,
      shareEnabled: true,
      currentVersionId: true,
      revokedAt: true,
      versions: { select: { id: true, versionNumber: true, uploadedAt: true } },
    },
  });
  if (!document || document.deletedAt || !document.shareEnabled) return false;
  if (document.externalUrl) return document.status === "published";
  if (!document.currentVersionId) return false;
  const reviewRequests = await prisma.reviewRequest.findMany({
    where: { documentId },
    select: { roundNumber: true, status: true, comments: true, createdAt: true },
  });
  return everApprovedVersionIds(document.versions, reviewRequests, document.revokedAt).has(document.currentVersionId);
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

// PATCH /api/documents/:id/share — { shareEnabled: boolean }
// Lets a manager/superadmin or this document's own uploader turn sharing on
// or off any time after publish, not just the one-time choice made at
// approval (see ReviewActions.tsx's "share" prompt) — same permission model
// and same UI placement (components/ShareSettings.tsx, in the Manage tab)
// as feedbackEnabled's own PATCH on the feedback route. Unlike feedback,
// turning this off also deactivates any share link already issued (below)
// rather than merely blocking new ones — a manager choosing "no sharing"
// means exactly that, not "no NEW sharing," and it's what
// app/share/[token]/page.tsx's own "may have expired, been turned off"
// copy already promises.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    select: { deletedAt: true, uploadedById: true, title: true },
  });
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const canManage = user.role === "manager" || user.role === "superadmin" || document.uploadedById === user.id;
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { shareEnabled } = await req.json();
  if (typeof shareEnabled !== "boolean") {
    return NextResponse.json({ error: "shareEnabled must be true or false." }, { status: 400 });
  }

  await prisma.document.update({ where: { id: params.id }, data: { shareEnabled } });
  if (!shareEnabled) {
    await prisma.shareLink.deleteMany({ where: { documentId: params.id } });
  }
  await logAudit({ userId: user.id, action: "edit", documentId: params.id, documentTitle: document.title });

  return NextResponse.json({ ok: true });
}
