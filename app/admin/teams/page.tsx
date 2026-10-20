import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PeopleTabs from "@/components/PeopleTabs";
import InfoTooltip from "@/components/InfoTooltip";
import { prisma } from "@/lib/prisma";
import TeamManager from "./TeamManager";

export default async function TeamsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageTeams")) redirect("/dashboard");

  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          memberships: { where: { user: { isActive: true } } },
          documentAccess: { where: { document: { visibility: "restricted" } } },
        },
      },
    },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8">
        <PeopleTabs active="teams" />
        <div className="mb-6 max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
            Teams
            <InfoTooltip text="Teams people belong to in Manage Users. A person can be in several teams. Restricted documents are visible only to their teams. People with Sees all teams (set in Manage Users) can view every team's documents." />
          </h1>
          <p className="text-sm text-ff-textMuted">Teams available in Manage Users.</p>
        </div>

        <TeamManager
          initialTeams={teams.map((t) => ({
            id: t.id,
            name: t.name,
            userCount: t._count.memberships,
            restrictedDocCount: t._count.documentAccess,
          }))}
        />
        </div>
        <Footer />
      </main>
    </div>
  );
}
