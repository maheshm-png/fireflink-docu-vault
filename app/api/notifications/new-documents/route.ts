import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// GET /api/notifications/new-documents — this user's unread "published"
// notifications, joined out to the documents' categories. Polled by
// components/NewDocumentsProvider.tsx (ticker entries + the NewBadge on
// Published Documents rows/tiles and Home category tiles) so those surfaces
// self-update once a document is actually opened (see the read-marking
// side-effect in app/dashboard/documents/[id]/page.tsx) without requiring a
// full page refresh — the same self-correcting-without-refresh behavior
// components/NotificationBell.tsx already has via its own poll loop.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unread = await prisma.notification.findMany({
    where: { userId: user.id, type: "published", read: false },
    orderBy: { createdAt: "desc" },
    select: { documentId: true, documentTitle: true },
  });
  const documentIds = unread.map((n) => n.documentId).filter((id): id is string => id !== null);

  const docs = documentIds.length
    ? await prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, categoryId: true } })
    : [];
  const categoryIds = [...new Set(docs.map((d) => d.categoryId))];

  const recentDocs = unread
    .slice(0, 5)
    .filter((n): n is { documentId: string; documentTitle: string | null } => n.documentId !== null)
    .map((n) => ({ id: n.documentId, title: n.documentTitle ?? "Untitled document" }));

  return NextResponse.json({ documentIds, categoryIds, recentDocs });
}
