import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import { prisma } from "@/lib/prisma";
import AnnouncementManager from "./AnnouncementManager";

export default async function AnnouncementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageAnnouncements")) redirect("/dashboard");

  const announcements = await prisma.announcement.findMany({
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-ff-text">Announcements</h1>
          <p className="text-sm text-ff-textMuted">
            Messages posted here scroll in the ticker at the top of every user&apos;s dashboard, alongside
            automatic &quot;new document published&quot; notices. Hold a message to pause it without losing
            it, or delete it for good.
          </p>
        </div>

        <AnnouncementManager
          initialAnnouncements={announcements.map((a) => ({
            id: a.id,
            message: a.message,
            isActive: a.isActive,
            createdByName: a.createdBy.name,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
        </div>
      </main>
    </div>
  );
}
