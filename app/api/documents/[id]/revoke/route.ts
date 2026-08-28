import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { removeFromIndex } from "@/lib/search";
import { logAudit } from "@/lib/audit";
import { notifyDocumentRevoked, notifyManagerReviewNeeded } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

// POST /api/documents/:id/revoke — manager pulls a published doc down.
// Mirrors the upload flow: sets status to "revoked" (hidden from the public
// dashboard immediately) and opens a fresh ReviewRequest against everyone
// who reviewed the previous round, so republishing goes through the same
// approval gate as a new upload rather than being an instant one-click
// toggle. This used to always reopen against document.ownerId (the reviewer
// picked at the very first upload, which never changes) — same bug as
// app/api/documents/[id]/versions/route.ts had: the new row landed in the
// SAME round number as that original review, so the trail (app/dashboard/
// documents/[id]/ReviewTrail.tsx) showed an already-resolved, already-
// published round as "in progress" again. Bumping the round and reusing the
// previous round's actual reviewer(s) fixes both.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCan(user.role, "revokeDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { reason } = await req.json().catch(() => ({ reason: undefined }));
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: { currentVersion: true, category: true },
  });

  if (document.status !== "published") {
    return NextResponse.json({ error: "Only published documents can be revoked" }, { status: 400 });
  }

  const maxRoundSoFar = await prisma.reviewRequest.aggregate({
    where: { documentId: document.id },
    _max: { roundNumber: true },
  });
  const previousRoundRequests = maxRoundSoFar._max.roundNumber
    ? await prisma.reviewRequest.findMany({
        where: { documentId: document.id, roundNumber: maxRoundSoFar._max.roundNumber },
        include: { reviewer: true },
      })
    : [];
  const previousReviewers = [...new Map(previousRoundRequests.map((r) => [r.reviewerId, r.reviewer])).values()].filter(
    (r) => r.isActive && r.role === "manager"
  );
  // Falls back to the document's original reviewer if the previous round
  // somehow left no active manager behind — better than blocking the revoke
  // entirely over a re-review assignment that a manager can always fix
  // afterward via Reassign.
  const reviewers =
    previousReviewers.length > 0
      ? previousReviewers
      : [{ id: document.ownerId, name: null as string | null, email: null as string | null }];
  const nextRound = (maxRoundSoFar._max.roundNumber ?? 0) + 1;

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "revoked", revokeReason: reason.trim(), revokedById: user.id, revokedAt: new Date() },
  });

  await removeFromIndex(document.id);

  await prisma.reviewRequest.createMany({
    data: reviewers.map((reviewer) => ({
      documentId: document.id,
      requestedById: user.id,
      reviewerId: reviewer.id,
      roundNumber: nextRound,
    })),
  });

  await logAudit({ userId: user.id, action: "revoke", documentId: document.id, documentTitle: document.title });

  for (const reviewer of reviewers) {
    if (!reviewer.name || !reviewer.email) continue;
    await notifyManagerReviewNeeded({
      documentTitle: document.title,
      documentId: document.id,
      categoryName: document.category.name,
      uploaderName: user.name,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      reviewerEmail: reviewer.email,
      isNewVersion: false,
    });
  }

  const recipients = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  await notifyDocumentRevoked({
    documentTitle: document.title,
    documentId: document.id,
    versionNumber: document.currentVersion?.versionNumber,
    recipients,
  });

  return NextResponse.json({ ok: true });
}
