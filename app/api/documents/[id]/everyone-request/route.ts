import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { refreshIndexedAccess } from "@/lib/search";
import { notifyEveryoneDecided, notifyEveryoneRequested, fireNotification } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { resolveGlobalCategory } from "@/lib/teamCategory";
import { canRequestEveryone, decidesEveryoneRequests, passesTeamGate, writeAccessChange } from "@/lib/access";

// "Request for Everyone" (lib/access.ts): nobody inside a team takes one of
// its restricted documents org-wide directly. A team manager raises a
// request with a reason; the Global approver (one org manager picked by a
// superadmin in Settings) approves it from My Work > Waiting on me, which makes the document visible to
// everyone, or sends it back with a comment, which leaves it with its teams.
//
//   POST   { reason }                                 raise (team manager)
//   PATCH  { decision: "approve" | "send_back", comment? }  decide (Global approver)
//   DELETE                                            withdraw (whoever raised it)
//
// At most one request is pending per document at a time.

const MAX_TEXT = 1000;

async function loadDocument(id: string) {
  return prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      visibility: true,
      teamAccess: { select: { teamId: true } },
      globalRequests: { where: { status: "pending" }, take: 1, include: { requestedBy: { select: { id: true, name: true, email: true } } } },
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await loadDocument(params.id);
  if (!document || document.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (document.visibility !== "restricted") {
    return NextResponse.json({ error: "This document is already visible to everyone." }, { status: 400 });
  }
  if (!canRequestEveryone(user, document)) {
    return NextResponse.json({ error: "Only a manager of this document's team can request it for everyone." }, { status: 403 });
  }
  if (document.status !== "published") {
    return NextResponse.json({ error: "Publish the document to its teams first, then request it for everyone." }, { status: 400 });
  }
  if (document.globalRequests.length > 0) {
    return NextResponse.json({ error: "A Request for Everyone is already waiting for a decision." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "Say why everyone in the organization should see it." }, { status: 400 });
  if (reason.length > MAX_TEXT) return NextResponse.json({ error: `Keep the reason under ${MAX_TEXT} characters.` }, { status: 400 });

  const approvers = await prisma.user.findMany({
    where: { isGlobalApprover: true, role: "manager", isActive: true, id: { not: user.id } },
    select: { id: true, name: true, email: true },
  });
  if (approvers.length === 0) {
    return NextResponse.json(
      { error: "No Global approver is set up to decide this. Ask a superadmin to pick one in Settings." },
      { status: 400 }
    );
  }

  await prisma.globalPublishRequest.create({ data: { documentId: document.id, requestedById: user.id, reason } });
  await logAudit({ userId: user.id, action: "everyone_request", documentId: document.id, documentTitle: document.title });
  fireNotification(
    notifyEveryoneRequested({
      documentTitle: document.title,
      documentId: document.id,
      requestedByName: user.name,
      reason,
      approvers,
    })
  );

  return NextResponse.json({ ok: true, notified: approvers.length }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!decidesEveryoneRequests(user)) {
    return NextResponse.json({ error: "Only the Global approver can decide a Request for Everyone." }, { status: 403 });
  }

  const document = await loadDocument(params.id);
  const request = document?.globalRequests[0];
  if (!document || document.deletedAt || !request) {
    return NextResponse.json({ error: "There's no Request for Everyone waiting on this document." }, { status: 404 });
  }
  if (request.requestedById === user.id) {
    return NextResponse.json({ error: "You raised this request, so you can't decide it yourself. Ask a superadmin to pick a different Global approver." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const decision = body.decision;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (decision !== "approve" && decision !== "send_back") {
    return NextResponse.json({ error: "Choose approve or send back." }, { status: 400 });
  }
  // It may have been archived or sent back to review after the request was
  // raised; approving then would open a hidden document to everyone.
  if (decision === "approve" && document.status !== "published") {
    return NextResponse.json(
      { error: "This document isn't published right now (archived or back in review). Send the request back, or wait until it's published again." },
      { status: 409 }
    );
  }
  if (decision === "send_back" && !comment) {
    return NextResponse.json({ error: "Add a comment so the team knows why it was sent back." }, { status: 400 });
  }
  if (comment.length > MAX_TEXT) return NextResponse.json({ error: `Keep the comment under ${MAX_TEXT} characters.` }, { status: 400 });

  // Approving needs the global category it joins, and that category's
  // required details: team documents have no category (lib/teamCategory.ts).
  let globalCategory: { categoryId: string; metadata: Record<string, unknown> } | undefined;
  if (decision === "approve") {
    const picked = await resolveGlobalCategory(body.categoryId, body.metadata);
    if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 });
    globalCategory = { categoryId: picked.categoryId, metadata: picked.metadata };
  }

  // Claim the request first so two approvers deciding at once can't both act.
  const claimed = await prisma.globalPublishRequest.updateMany({
    where: { id: request.id, status: "pending" },
    data: {
      status: decision === "approve" ? "approved" : "rejected",
      decidedById: user.id,
      decisionComment: comment || null,
      decidedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "This request was already decided." }, { status: 409 });
  }

  if (decision === "approve" && document.visibility === "restricted") {
    await writeAccessChange(user, document.id, "org", [], globalCategory);
    await refreshIndexedAccess(document.id);
    await logAudit({ userId: user.id, action: "change_access", documentId: document.id, documentTitle: document.title });
  }
  await logAudit({
    userId: user.id,
    action: decision === "approve" ? "everyone_request_approved" : "everyone_request_sent_back",
    documentId: document.id,
    documentTitle: document.title,
  });

  fireNotification(
    notifyEveryoneDecided({
      documentTitle: document.title,
      documentId: document.id,
      approved: decision === "approve",
      decidedByName: user.name,
      comment: comment || null,
      requester: request.requestedBy,
    })
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await passesTeamGate(user, params.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const document = await loadDocument(params.id);
  const request = document?.globalRequests[0];
  if (!document || !request) {
    return NextResponse.json({ error: "There's no Request for Everyone waiting on this document." }, { status: 404 });
  }
  if (request.requestedById !== user.id) {
    return NextResponse.json({ error: "Only the person who raised this request can withdraw it." }, { status: 403 });
  }

  // Withdrawn requests leave no row behind: nothing was decided.
  await prisma.globalPublishRequest.deleteMany({ where: { id: request.id, status: "pending" } });
  await logAudit({ userId: user.id, action: "everyone_request_withdrawn", documentId: document.id, documentTitle: document.title });
  return NextResponse.json({ ok: true });
}
