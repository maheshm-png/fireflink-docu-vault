import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { documentRole, passesTeamGate } from "@/lib/access";
import { notifyMergeRequested, fireNotification } from "@/lib/notify";
import { canStartMerge, findMergeTargets, loadForMerge, mergeDocuments, MergeError, pickMergeApprover } from "@/lib/merge";

// Merging this document into another one (lib/merge.ts).
//   GET    ?q=...          documents it could be merged into
//   POST   { targetId }    merge now when the caller manages the target,
//                          otherwise ask the target's manager
//   DELETE                 withdraw the caller's pending request
async function loadSource(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await passesTeamGate(user, id))) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const source = await loadForMerge(id);
  if (!source || source.deletedAt) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!canStartMerge(user, documentRole(user, source), source)) {
    return {
      error: NextResponse.json(
        { error: "Only a manager of this document, or the contributor who uploaded it, can merge it." },
        { status: 403 }
      ),
    };
  }
  return { user, source };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadSource(params.id);
  if ("error" in loaded) return loaded.error;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await findMergeTargets(loaded.user, loaded.source.id, q) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await loadSource(params.id);
  if ("error" in loaded) return loaded.error;
  const { user, source } = loaded;

  const { targetId } = await req.json().catch(() => ({}));
  if (typeof targetId !== "string" || targetId === source.id) {
    return NextResponse.json({ error: "Choose the document to keep." }, { status: 400 });
  }
  // A target the caller can't see is "not found", same as everywhere else.
  const target = (await passesTeamGate(user, targetId)) ? await loadForMerge(targetId) : null;
  if (!target || target.deletedAt) return NextResponse.json({ error: "That document isn't available." }, { status: 404 });

  if (documentRole(user, target) === "manager") {
    try {
      await mergeDocuments(user.id, source.id, target.id);
    } catch (e) {
      if (e instanceof MergeError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    await logAudit({ userId: user.id, action: "merge", documentId: source.id, documentTitle: `${source.title} (merged into "${target.title}")` });
    return NextResponse.json({ ok: true, merged: true, targetId: target.id });
  }

  const existing = await prisma.mergeRequest.findFirst({ where: { sourceId: source.id, status: "pending" } });
  if (existing) {
    return NextResponse.json({ error: "A merge request for this document is already waiting. Withdraw it first." }, { status: 409 });
  }
  const approver = await pickMergeApprover(target, user.id);
  if (!approver) {
    return NextResponse.json({ error: "Nobody can approve a merge into that document right now. Ask one of its managers." }, { status: 400 });
  }
  await prisma.mergeRequest.create({
    data: { sourceId: source.id, targetId: target.id, requestedById: user.id, approverId: approver.id },
  });
  await logAudit({ userId: user.id, action: "merge_request", documentId: source.id, documentTitle: `${source.title} (into "${target.title}")` });
  fireNotification(
    notifyMergeRequested({
      sourceTitle: source.title,
      targetTitle: target.title,
      targetId: target.id,
      requestedByName: user.name,
      approver,
    })
  );
  return NextResponse.json({ ok: true, merged: false, approverName: approver.name });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pending = await prisma.mergeRequest.findFirst({
    where: { sourceId: params.id, status: "pending", requestedById: user.id },
  });
  if (!pending) return NextResponse.json({ error: "You have no merge request waiting on this document." }, { status: 404 });
  await prisma.mergeRequest.update({ where: { id: pending.id }, data: { status: "withdrawn", decidedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
