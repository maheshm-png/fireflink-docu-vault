import { redirect } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import { prisma } from "@/lib/prisma";
import { LocalDateTime } from "@/components/LocalDateTime";
import RestoreButton from "./RestoreButton";

const RECOVERY_WINDOW_DAYS = 30;

export default async function DeletedDocumentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "viewDeleted")) redirect("/dashboard");

  const docs = await prisma.document.findMany({
    where: { deletedAt: { not: null } },
    include: { category: true, deletedBy: true },
    orderBy: { deletedAt: "desc" },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-5xl px-6 py-8 animate-fade-in">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Deleted Documents</h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          Deleted documents stay recoverable for {RECOVERY_WINDOW_DAYS} days before being permanently removed.
        </p>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-ff border border-ff-border bg-white p-10 text-center">
            <Trash2 className="h-8 w-8 text-ff-textMuted" aria-hidden />
            <p className="font-medium text-ff-text">Nothing here</p>
            <p className="text-sm text-ff-textMuted">No deleted documents are currently pending permanent removal.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Deleted By</th>
                  <th className="px-4 py-2 font-medium">Deleted On</th>
                  <th className="px-4 py-2 font-medium">Recovery Window</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const ageDays = (Date.now() - doc.deletedAt!.getTime()) / (1000 * 60 * 60 * 24);
                  const daysLeft = Math.max(0, Math.ceil(RECOVERY_WINDOW_DAYS - ageDays));
                  return (
                    <tr key={doc.id} className="border-t border-ff-border">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/documents/${doc.id}`} className="text-ff-accent hover:underline">
                          {doc.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ff-textMuted">{doc.category.name}</td>
                      <td className="px-4 py-3 text-ff-textMuted">{doc.deletedBy?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ff-textMuted"><LocalDateTime value={doc.deletedAt!} /></td>
                      <td className="px-4 py-3 text-ff-textMuted">
                        {daysLeft > 0 ? (
                          <span className={daysLeft <= 5 ? "text-ff-warning" : ""}>{daysLeft} day{daysLeft === 1 ? "" : "s"} left</span>
                        ) : (
                          <span className="text-ff-danger">Purging soon</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RestoreButton documentId={doc.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
