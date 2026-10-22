import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { indexDocument, refreshIndexedAccess, removeFromIndex } from "./search";
import { documentAccessWhere, documentRole, eligibleReviewerWhere, stakeSelect, type AccessUser } from "./access";
import type { Role } from "./rbac";

// Merging two uploads of the same thing (typically one video uploaded twice
// under different names) into one. The source document is removed and the
// target kept:
//   - the source's tags are added to the target,
//   - when both are team documents, the source's teams get the target too
//     (in the same folder), so nobody who could see the copy loses it,
//   - anything flagged as a duplicate of the source points at the target,
//   - the source is soft-deleted, so it stays restorable from Deleted
//     documents for 30 days like any other delete.
//
// Who may do it:
//   - start a merge from a document: a manager of it (documentRole), or the
//     contributor who uploaded it.
//   - merge directly: someone who may start it AND manages the target.
//   - otherwise it becomes a MergeRequest the target's manager approves
//     (pickMergeApprover), since the target is theirs.

/** May this user start a merge of this document into another one? */
export function canStartMerge(user: AccessUser, role: Role, source: { uploadedById: string }): boolean {
  return role === "manager" || (role === "contributor" && source.uploadedById === user.id);
}

/** Load a document with what documentRole needs. */
export async function loadForMerge(id: string) {
  return prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      tags: true,
      visibility: true,
      teamAccess: { select: { teamId: true, folderId: true } },
      ...stakeSelect,
    },
  });
}

/** The target's manager who decides a merge request: its owner when they
 * may still review it, otherwise its most recent reviewer who may, otherwise
 * the Global approver. Never the person asking. */
export async function pickMergeApprover(
  target: NonNullable<Awaited<ReturnType<typeof loadForMerge>>>,
  requesterId: string
) {
  const eligible = eligibleReviewerWhere(target);
  const reviewerIds = [...target.reviewRequests.map((r) => r.reviewerId)].reverse();
  for (const id of [target.ownerId, ...reviewerIds]) {
    if (id === requesterId) continue;
    const u = await prisma.user.findFirst({ where: { AND: [{ id }, eligible] }, select: { id: true, name: true, email: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { AND: [eligible, { isGlobalApprover: true }, { id: { not: requesterId } }] },
    select: { id: true, name: true, email: true },
  });
}

/** Documents this user could merge into: ones they can see that are live
 * (published, or in re-review with an approved version) or that they're
 * involved in, matching the title or a tag. */
export async function findMergeTargets(user: AccessUser, sourceId: string, query: string) {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const reach: Prisma.DocumentWhereInput =
    user.role === "superadmin"
      ? {}
      : {
          OR: [
            { status: "published" },
            { status: { in: ["pending_review", "revoked"] }, currentVersionId: { not: null } },
            { uploadedById: user.id },
            { ownerId: user.id },
            { reviewRequests: { some: { reviewerId: user.id } } },
          ],
        };
  const docs = await prisma.document.findMany({
    where: {
      AND: [
        { deletedAt: null, id: { not: sourceId } },
        documentAccessWhere(user),
        reach,
        ...words.map((w) => ({ OR: [{ title: { contains: w, mode: "insensitive" as const } }, { tags: { has: w.toLowerCase() } }] })),
      ],
    },
    select: {
      id: true,
      title: true,
      docType: true,
      status: true,
      visibility: true,
      updatedAt: true,
      category: { select: { name: true, isSystem: true } },
      teamAccess: { select: { teamId: true, team: { select: { name: true } } } },
      ...stakeSelect,
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    docType: d.docType,
    where: d.category.isSystem ? `${d.teamAccess.map((t) => t.team.name).sort().join(", ") || "Team"} team` : d.category.name,
    // Merges straight away, or goes to the target's manager as a request.
    direct: documentRole(user, d) === "manager",
  }));
}

/** Runs the merge. Callers have already checked permissions. */
export async function mergeDocuments(actorId: string, sourceId: string, targetId: string) {
  const [source, target] = await Promise.all([loadForMerge(sourceId), loadForMerge(targetId)]);
  if (!source || source.deletedAt) throw new MergeError("The document to merge has been deleted.");
  if (!target || target.deletedAt) throw new MergeError("The document to keep has been deleted.");

  const targetTeamIds = new Set(target.teamAccess.map((t) => t.teamId));
  const newTeams =
    source.visibility === "restricted" && target.visibility === "restricted"
      ? source.teamAccess.filter((t) => !targetTeamIds.has(t.teamId))
      : [];
  const tags = Array.from(new Set([...target.tags, ...source.tags]));

  await prisma.$transaction([
    prisma.document.update({ where: { id: target.id }, data: { tags } }),
    prisma.documentTeamAccess.createMany({
      data: newTeams.map((t) => ({ documentId: target.id, teamId: t.teamId, grantedById: actorId, folderId: t.folderId })),
      skipDuplicates: true,
    }),
    // The target can't be a duplicate of itself.
    prisma.document.updateMany({
      where: { duplicateOfId: source.id, id: target.id },
      data: { duplicateOfId: null, duplicateReason: null },
    }),
    prisma.document.updateMany({
      where: { duplicateOfId: source.id, id: { not: target.id } },
      data: { duplicateOfId: target.id },
    }),
    // Any other request to merge the source anywhere is moot now.
    prisma.mergeRequest.updateMany({
      where: { status: "pending", OR: [{ sourceId: source.id }, { targetId: source.id }] },
      data: { status: "withdrawn", decidedAt: new Date() },
    }),
    prisma.document.update({ where: { id: source.id }, data: { deletedAt: new Date(), deletedById: actorId } }),
  ]);

  await removeFromIndex(source.id);
  // The dashboard reads tags and team access from the search index.
  const merged = await prisma.document.findUniqueOrThrow({
    where: { id: target.id },
    include: { category: true, currentVersion: true, uploadedBy: true, duplicateOf: true },
  });
  if (merged.status === "published") {
    await indexDocument({
      id: merged.id,
      title: merged.title,
      tags: merged.tags,
      categoryName: merged.category.name,
      docType: merged.docType,
      status: merged.status,
      extractedText: merged.currentVersion?.extractedText ?? "",
      uploadedByName: merged.uploadedBy.name,
      isStale: false,
      updatedAt: merged.updatedAt.toISOString(),
      duplicateOfTitle: merged.duplicateOf?.title ?? null,
      hasPreviewPdf: Boolean(merged.currentVersion?.previewPdfPath),
    });
  } else if (newTeams.length) {
    await refreshIndexedAccess(target.id);
  }

  return { source, target };
}

export class MergeError extends Error {}
