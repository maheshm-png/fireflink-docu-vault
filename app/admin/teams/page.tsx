import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";
import { prisma } from "@/lib/prisma";
import TeamManager from "./TeamManager";

export default async function TeamsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageTeams")) redirect("/dashboard");

  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
            Teams
            <InfoTooltip text="The team/department options offered on each user's profile in Manage Users, and what Manage Users groups people by. Removing one just clears it from anyone currently on it." />
          </h1>
          <p className="text-sm text-ff-textMuted">Teams available in Manage Users.</p>
        </div>

        <TeamManager
          initialTeams={teams.map((t) => ({ id: t.id, name: t.name, userCount: t._count.users }))}
        />
        </div>
      </main>
    </div>
  );
}
