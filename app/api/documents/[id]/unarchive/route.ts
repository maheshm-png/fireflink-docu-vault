import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { notifyManagerReviewNeeded, fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { documentRoleById, eligibleReviewerWhere, passesTeamGate } from "@/lib/access";

// POST /api/documents/:id/unarchive — manager restores an archived document.
// It goes back through approval before anyone sees it again: status
// "revoked" (shown as "Back in review") keeps it hidden, and a fresh review
// round opens against whoever reviewed the previous round. Archive replaced
// the separate Revoke action (2026-10-12): archiving takes a document out
// of circulation, restoring brings it back via review.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Team access control: a restricted document outside this user's teams
  // is a 404 here, same as one that doesn't exist (lib/access.ts).
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Team documents use the caller's team role (lib/access.ts documentRole).
    assertCan(await documentRoleById(user, params.id), "archiveDocument");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      category: true,
      teamAccess: { select: { teamId: true } },
      versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { uploadedById: true } },
    },
  });

  if (document.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted. Restore it first." }, { status: 409 });
  }

  if (document.status !== "archived") {
    return NextResponse.json({ error: "Only archived documents can be restored" }, { status: 400 });
  }

  // Reopen against the previous round's reviewers who may still review it
  // today (an active org manager, or for a team document a manager of one
  // of its teams). Never the document's own uploader: a "No review needed"
  // upload's only previous reviewer is the manager who published it, who
  // can't approve their own document, so it would sit in review forever.
  // Next in line: the manager restoring it, then the Global approver.
  const uploaderIds = new Set([document.uploadedById, document.versions[0]?.uploadedById].filter(Boolean));
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
  const eligibleIds = new Set(
    (
      await prisma.user.findMany({
        where: { AND: [{ id: { in: previousRoundRequests.map((r) => r.reviewerId) } }, eligibleReviewerWhere(document)] },
        select: { id: true },
      })
    ).map((u) => u.id)
  );
  let reviewers: { id: string; name: string; email: string }[] = [
    ...new Map(previousRoundRequests.map((r) => [r.reviewerId, r.reviewer])).values(),
  ].filter((r) => eligibleIds.has(r.id) && !uploaderIds.has(r.id));
  if (reviewers.length === 0) {
    const fallback = await prisma.user.findFirst({
      where: {
        AND: [
          eligibleReviewerWhere(document),
          { id: { notIn: [...uploaderIds] as string[] } },
          { OR: [{ id: user.id }, { isGlobalApprover: true }] },
        ],
      },
      // The restoring manager first, the Global approver otherwise.
      orderBy: { isGlobalApprover: "asc" },
      select: { id: true, name: true, email: true },
    });
    if (!fallback) {
      return NextResponse.json(
        {
          error:
            "Nobody else can review this document, and you can't approve your own upload. Ask another manager, or the Everyone approver, to restore it.",
        },
        { status: 400 }
      );
    }
    reviewers = [fallback];
  }
  const nextRound = (maxRoundSoFar._max.roundNumber ?? 0) + 1;

  await prisma.document.update({
    where: { id: document.id },
    data: { status: "revoked", revokeReason: null, revokedById: user.id, revokedAt: new Date() },
  });

  await prisma.reviewRequest.createMany({
    data: reviewers.map((reviewer) => ({
      documentId: document.id,
      requestedById: user.id,
      reviewerId: reviewer.id,
      roundNumber: nextRound,
    })),
  });

  await logAudit({ userId: user.id, action: "unarchive", documentId: document.id, documentTitle: document.title });

  fireNotification(
    Promise.all(
      reviewers.map((reviewer) =>
        notifyManagerReviewNeeded({
          documentTitle: document.title,
          documentId: document.id,
          categoryName: document.category.name,
          uploaderName: user.name,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          reviewerEmail: reviewer.email,
          isNewVersion: false,
        })
      )
    )
  );

  return NextResponse.json({ ok: true });
}
