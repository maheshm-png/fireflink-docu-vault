import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { prisma } from "@/lib/prisma";
import AnnouncementManager from "./AnnouncementManager";
import InfoTooltip from "@/components/InfoTooltip";

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
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 max-w-2xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ff-text">
            Announcements
            <InfoTooltip text={`Messages posted here scroll in the ticker at the top of every user's dashboard, alongside automatic "new document published" notices. Hold a message to pause it without losing it, or delete it for good.`} />
          </h1>
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
        <Footer />
      </main>
    </div>
  );
}
