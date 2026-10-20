// "New document" notices (unread "published" notifications) for one section
// of Home: documents for everyone, or one team's documents. Each section
// only shows its own, so a team document never appears in the Everyone
// ticker and vice versa. Used by Home (first paint) and
// /api/notifications/new-documents (NewDocumentsProvider's poll).
import { prisma } from "./prisma";
import { withoutDeletedDocuments } from "./notifications";
import type { AccessUser } from "./access";

export type NewDocsScope = { kind: "everyone" } | { kind: "team"; teamId: string };

export function parseNewDocsScope(raw: { scope?: string | null; team?: string | null }): NewDocsScope {
  return raw.scope === "team" && raw.team ? { kind: "team", teamId: raw.team } : { kind: "everyone" };
}

export async function newDocumentsFor(user: AccessUser & { id: string }, scope: NewDocsScope) {
  const unread = await withoutDeletedDocuments(
    user,
    await prisma.notification.findMany({
      where: { userId: user.id, type: "published", read: false },
      orderBy: { createdAt: "desc" },
      select: { documentId: true, documentTitle: true },
    })
  );
  const ids = unread.map((n) => n.documentId).filter((id): id is string => id !== null);
  const docs = ids.length
    ? await prisma.document.findMany({
        where: {
          id: { in: ids },
          ...(scope.kind === "everyone"
            ? { visibility: "org" as const }
            : { visibility: "restricted" as const, teamAccess: { some: { teamId: scope.teamId } } }),
        },
        select: { id: true, categoryId: true },
      })
    : [];
  const inScope = new Set(docs.map((d) => d.id));
  const documentIds = ids.filter((id) => inScope.has(id));
  const categoryIds = [...new Set(docs.map((d) => d.categoryId))];
  const recentDocs = unread
    .filter((n): n is { documentId: string; documentTitle: string | null } => n.documentId !== null && inScope.has(n.documentId))
    .slice(0, 5)
    .map((n) => ({ id: n.documentId, title: n.documentTitle ?? "Untitled document" }));
  return { documentIds, categoryIds, recentDocs };
}
