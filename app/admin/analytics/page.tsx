import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import { prisma } from "@/lib/prisma";
import { FileCheck, Clock, XCircle, Archive, RotateCcw, AlertTriangle, Trash2, Eye, Download, type LucideIcon } from "lucide-react";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "viewAuditLog")) redirect("/dashboard");

  const [
    topViewed,
    topDownloaded,
    publishedCount,
    pendingCount,
    rejectedCount,
    archivedCount,
    revokedCount,
    staleCount,
    deletedCount,
    totalViews,
    totalDownloads,
    topUploaders,
    byCategory,
  ] = await Promise.all([
    prisma.documentEvent.groupBy({
      by: ["documentId"],
      where: { type: "view" },
      _count: { documentId: true },
      orderBy: { _count: { documentId: "desc" } },
      take: 10,
    }),
    prisma.documentEvent.groupBy({
      by: ["documentId"],
      where: { type: "download" },
      _count: { documentId: true },
      orderBy: { _count: { documentId: "desc" } },
      take: 10,
    }),
    prisma.document.count({ where: { status: "published", deletedAt: null } }),
    prisma.document.count({ where: { status: "pending_review", deletedAt: null } }),
    prisma.document.count({ where: { status: "rejected", deletedAt: null } }),
    prisma.document.count({ where: { status: "archived", deletedAt: null } }),
    prisma.document.count({ where: { status: "revoked", deletedAt: null } }),
    prisma.document.count({ where: { deletedAt: null, stalenessFlags: { some: { resolved: false } } } }),
    prisma.document.count({ where: { deletedAt: { not: null } } }),
    prisma.documentEvent.count({ where: { type: "view" } }),
    prisma.documentEvent.count({ where: { type: "download" } }),
    prisma.document.groupBy({
      by: ["uploadedById"],
      where: { deletedAt: null },
      _count: { uploadedById: true },
      orderBy: { _count: { uploadedById: "desc" } },
      take: 10,
    }),
    prisma.document.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null },
      _count: { categoryId: true },
      orderBy: { _count: { categoryId: "desc" } },
    }),
  ]);

  const docIds = [...new Set([...topViewed, ...topDownloaded].map((d) => d.documentId))];
  const [docs, uploaders, categories] = await Promise.all([
    prisma.document.findMany({ where: { id: { in: docIds } } }),
    prisma.user.findMany({ where: { id: { in: topUploaders.map((u) => u.uploadedById) } }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId) } }, select: { id: true, name: true } }),
  ]);
  const titleOf = (id: string) => docs.find((d) => d.id === id)?.title ?? "Unknown";
  const uploaderNameOf = (id: string) => uploaders.find((u) => u.id === id)?.name ?? "Unknown";
  const categoryNameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? "Unknown";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-6xl px-6 py-8 animate-fade-in">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Analytics</h1>
        <p className="mb-6 text-sm text-ff-textMuted">Click a tile to see the documents behind it.</p>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Published" value={publishedCount} icon={FileCheck} href="/dashboard" />
          <StatCard label="Pending Review" value={pendingCount} icon={Clock} href="/dashboard/pending" />
          <StatCard label="Rejected" value={rejectedCount} icon={XCircle} href="/dashboard/pending?status=rejected" />
          <StatCard label="Archived" value={archivedCount} icon={Archive} href="/dashboard/pending?status=archived" />
          <StatCard label="Revoked" value={revokedCount} icon={RotateCcw} href="/dashboard/revoked" />
          <StatCard label="Flagged Outdated" value={staleCount} icon={AlertTriangle} href="/admin/analytics/stale" />
          <StatCard label="Deleted" value={deletedCount} icon={Trash2} href="/admin/deleted" />
          <StatCard label="Total Views" value={totalViews} icon={Eye} />
          <StatCard label="Total Downloads" value={totalDownloads} icon={Download} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <ActivityTable
            title="Most Viewed"
            type="view"
            rows={topViewed.map((r) => ({ id: r.documentId, title: titleOf(r.documentId), count: r._count.documentId }))}
          />
          <ActivityTable
            title="Most Downloaded"
            type="download"
            rows={topDownloaded.map((r) => ({ id: r.documentId, title: titleOf(r.documentId), count: r._count.documentId }))}
          />
          <SimpleTable
            title="Top Uploaders"
            rows={topUploaders.map((u) => ({ label: uploaderNameOf(u.uploadedById), count: u._count.uploadedById }))}
          />
          <SimpleTable
            title="Documents by Category"
            rows={byCategory.map((c) => ({ label: categoryNameOf(c.categoryId), count: c._count.categoryId }))}
          />
        </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  href?: string;
}) {
  const content = (
    <div
      className={`flex items-start justify-between rounded-ff border border-ff-border bg-white p-4 shadow-ff transition-all ${
        href ? "hover:-translate-y-0.5 hover:border-ff-accent/30 hover:shadow-ff-md" : ""
      }`}
    >
      <div>
        <div className="text-2xl font-semibold text-ff-text">{value}</div>
        <div className="text-sm text-ff-textMuted">{label}</div>
      </div>
      <Icon className="h-5 w-5 shrink-0 text-ff-accent/60" aria-hidden />
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

// Title is plain text (opening the document itself lives on the document
// page already) — the count is the clickable part, since what someone
// actually wants from "Most Viewed"/"Most Downloaded" is usually WHO did
// that, not another way to open the document.
function ActivityTable({
  title,
  type,
  rows,
}: {
  title: string;
  type: "view" | "download";
  rows: { id: string; title: string; count: number }[];
}) {
  return (
    <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      <div className="border-b-2 border-ff-accent/20 bg-ff-lavender px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ff-textMuted">No activity yet.</div>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-ff-border">
                <td className="px-4 py-2 text-ff-text">{r.title}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/analytics/activity/${r.id}?type=${type}`} className="text-ff-accent hover:underline">
                    {r.count}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SimpleTable({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return (
    <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
      <div className="border-b-2 border-ff-accent/20 bg-ff-lavender px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-ff-textMuted">No data yet.</div>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-ff-border">
                <td className="px-4 py-2 text-ff-text">{r.label}</td>
                <td className="px-4 py-2 text-right text-ff-textMuted">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
