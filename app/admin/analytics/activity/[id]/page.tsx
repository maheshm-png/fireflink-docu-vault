import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import { LocalDateTime } from "@/components/LocalDateTime";

// Per-document drill-down for the Analytics page's Most Viewed/Most
// Downloaded tables — clicking the count (not the title, which just opens
// the document itself) shows who actually viewed or downloaded it, not
// just how many times.
export default async function DocumentActivityPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { type?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "viewAuditLog")) redirect("/dashboard");

  const type = searchParams.type === "download" ? "download" : "view";

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  if (!document) notFound();

  const events = await prisma.documentEvent.findMany({
    where: { documentId: params.id, type },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { timestamp: "desc" },
  });

  const byUser = new Map<string, { name: string; email: string; count: number; lastAt: Date }>();
  for (const e of events) {
    const existing = byUser.get(e.userId);
    if (existing) {
      existing.count += 1;
      if (e.timestamp > existing.lastAt) existing.lastAt = e.timestamp;
    } else {
      byUser.set(e.userId, { name: e.user.name, email: e.user.email, count: 1, lastAt: e.timestamp });
    }
  }
  const rows = [...byUser.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-3xl px-6 py-8 animate-fade-in">
        <Link href="/admin/analytics" className="mb-4 inline-block text-sm text-ff-accent hover:underline">
          ← Back to Analytics
        </Link>
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">
          {type === "download" ? "Downloaded by" : "Viewed by"}
        </h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          <Link href={`/dashboard/documents/${document.id}`} className="text-ff-accent hover:underline">
            {document.title}
          </Link>
        </p>

        <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
          {rows.length === 0 ? (
            <div className="p-4 text-sm text-ff-textMuted">No activity yet.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
                <tr>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Times</th>
                  <th className="px-4 py-2 font-medium">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email} className="border-t border-ff-border">
                    <td className="px-4 py-2 text-ff-text">{r.name}</td>
                    <td className="px-4 py-2 text-ff-textMuted">{r.email}</td>
                    <td className="px-4 py-2 text-ff-textMuted">{r.count}</td>
                    <td className="px-4 py-2 text-ff-textMuted"><LocalDateTime value={r.lastAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </main>
    </div>
  );
}
