import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import { prisma } from "@/lib/prisma";
import { LocalDateTime } from "@/components/LocalDateTime";

// AuditLog.action is a raw snake_case identifier ("post_announcement") —
// forcing it uppercase via CSS just produced "POST_ANNOUNCEMENT", underscore
// and all. This reads it as actual words instead: "Post Announcement".
function formatAction(action: string) {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function AuditLogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "viewAuditLog")) redirect("/dashboard");

  const entries = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: { timestamp: "desc" },
    take: 200,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-ff-text">Audit Log</h1>
        <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
          <table className="w-full text-left text-sm">
            <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Document</th>
                <th className="px-4 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-ff-border">
                  <td className="px-4 py-2 text-ff-textMuted"><LocalDateTime value={e.timestamp} /></td>
                  <td className="px-4 py-2">{e.user.name}</td>
                  <td className="px-4 py-2 text-ff-textMuted">{formatAction(e.action)}</td>
                  <td className="px-4 py-2 text-ff-textMuted">
                    {e.documentId ? (
                      <Link href={`/dashboard/documents/${e.documentId}`} className="text-ff-accent hover:underline">
                        {e.documentTitle ?? e.documentId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-ff-textMuted">{e.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </main>
    </div>
  );
}
