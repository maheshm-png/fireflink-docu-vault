import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canReviewDocument } from "@/lib/access";
import { notifyMergeDecided, fireNotification } from "@/lib/notify";
import { loadForMerge, mergeDocuments, MergeError } from "@/lib/merge";

// PATCH /api/merge-requests/:id { decision: "approve" | "decline" }: the
// target document's manager decides a merge request (lib/merge.ts).
// Approving runs the merge.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const request = await prisma.mergeRequest.findUnique({
    where: { id: params.id },
    include: { requestedBy: { select: { id: true, name: true, email: true } } },
  });
  if (!request || request.approverId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.status !== "pending") return NextResponse.json({ error: "This request has already been decided." }, { status: 409 });

  const { decision } = await req.json().catch(() => ({}));
  if (decision !== "approve" && decision !== "decline") {
    return NextResponse.json({ error: "Unknown decision" }, { status: 400 });
  }

  const [source, target] = await Promise.all([loadForMerge(request.sourceId), loadForMerge(request.targetId)]);
  if (!source || !target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (decision === "approve") {
    // Still one of the target's managers (team roles can change).
    if (!canReviewDocument(user, target)) {
      return NextResponse.json({ error: "You no longer manage this document." }, { status: 403 });
    }
    try {
      await mergeDocuments(user.id, source.id, target.id);
    } catch (e) {
      if (e instanceof MergeError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  await prisma.mergeRequest.update({
    where: { id: request.id },
    data: { status: decision === "approve" ? "approved" : "declined", decidedAt: new Date() },
  });
  await logAudit({
    userId: user.id,
    action: decision === "approve" ? "merge" : "merge_request_declined",
    documentId: source.id,
    documentTitle: `${source.title} (${decision === "approve" ? "merged into" : "not merged into"} "${target.title}")`,
  });
  fireNotification(
    notifyMergeDecided({
      approved: decision === "approve",
      sourceTitle: source.title,
      sourceId: source.id,
      targetTitle: target.title,
      targetId: target.id,
      decidedByName: user.name,
      requester: request.requestedBy,
    })
  );
  return NextResponse.json({ ok: true });
}
