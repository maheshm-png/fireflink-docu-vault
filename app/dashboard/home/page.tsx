import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import AnnouncementTicker from "@/components/AnnouncementTicker";
import CategoryIcon from "@/components/CategoryIcon";
import LiveNewCategoryBadge from "@/components/LiveNewCategoryBadge";
import { NewDocumentsProvider } from "@/components/NewDocumentsProvider";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Same category + published-count query as the Published Documents page
  // (app/dashboard/page.tsx) — each tile below links straight into that
  // page pre-filtered to the category it represents, so the count shown
  // here is exactly what clicking through will show.
  const [categories, counts, unreadPublishedNotifications] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { status: "published", deletedAt: null },
      _count: { _all: true },
    }),
    // Seeds NewDocumentsProvider below, same as app/dashboard/page.tsx — this
    // user's own unread "published" notifications, used two ways: the
    // ticker's "New: ..." entries, and which category tiles get their own
    // NewBadge (any category holding at least one such document). The
    // provider then polls from here on so both clear on their own once a
    // document is actually opened.
    prisma.notification.findMany({
      where: { userId: user.id, type: "published", read: false },
      orderBy: { createdAt: "desc" },
      select: { documentId: true, documentTitle: true },
    }),
  ]);
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const newDocIds = unreadPublishedNotifications.map((n) => n.documentId).filter((id): id is string => id !== null);
  const recentDocs = unreadPublishedNotifications
    .slice(0, 5)
    .filter((n): n is { documentId: string; documentTitle: string | null } => n.documentId !== null)
    .map((n) => ({ id: n.documentId, title: n.documentTitle ?? "Untitled document" }));

  const newDocCategories = newDocIds.length
    ? await prisma.document.findMany({ where: { id: { in: newDocIds } }, select: { categoryId: true } })
    : [];
  const newCategoryIds = [...new Set(newDocCategories.map((d) => d.categoryId))];

  const canUpload = can(user.role, "upload");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ff-text">Welcome, {user.name.split(" ")[0]}</h1>
            <p className="text-sm text-ff-textMuted">Browse by category, or jump straight to everything published.</p>
          </div>
          {canUpload && (
            <a
              href="/dashboard/upload"
              className="flex items-center gap-1 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Upload Document
            </a>
          )}
        </div>

        <NewDocumentsProvider
          initialDocumentIds={newDocIds}
          initialCategoryIds={newCategoryIds}
          initialRecentDocs={recentDocs}
        >
          <AnnouncementTicker />

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-ff-text">Categories</h2>
            <Link href="/dashboard" className="text-sm text-ff-accent hover:underline">
              View all published documents
            </Link>
          </div>

          {categories.length === 0 ? (
            <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
              No categories yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {categories.map((c) => {
                const count = countByCategory.get(c.id) ?? 0;
                return (
                  <Link
                    key={c.id}
                    href={`/dashboard?category=${c.id}`}
                    className="relative flex flex-col gap-3 rounded-ff border border-ff-border bg-white p-5 shadow-ff transition-all hover:-translate-y-0.5 hover:border-ff-accent/30 hover:shadow-ff-md"
                  >
                    <LiveNewCategoryBadge categoryId={c.id} className="absolute right-3 top-3" />
                    <span className="flex h-10 w-10 items-center justify-center rounded-ff bg-ff-lavender text-ff-accent">
                      <CategoryIcon name={c.name} />
                    </span>
                    <div>
                      <p className="text-2xl font-semibold text-ff-text">{count}</p>
                      <p className="text-sm text-ff-textMuted">{c.name}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </NewDocumentsProvider>
        </div>
      </main>
    </div>
  );
}
