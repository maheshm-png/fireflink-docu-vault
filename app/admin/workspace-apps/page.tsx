import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import InfoTooltip from "@/components/InfoTooltip";
import { prisma } from "@/lib/prisma";
import WorkspaceAppManager from "./WorkspaceAppManager";

export default async function WorkspaceAppsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageWorkspaceApps")) redirect("/dashboard");

  const apps = await prisma.workspaceApp.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8">
        <div className="max-w-3xl">
        <h1 className="mb-1 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
          Workspace Apps
          <InfoTooltip text="Controls the tiles on the FireFlink Workspace launcher (the page everyone lands on before signing in to Docu Vault). Leave the link blank to show a tile as Coming Soon instead." />
        </h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          What shows up on the FireFlink Workspace launcher, and in what order.
        </p>
        <WorkspaceAppManager
          initialApps={apps.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            description: a.description,
            href: a.href,
            icon: a.icon,
            sortOrder: a.sortOrder,
          }))}
        />
        </div>
        </div>
        <Footer />
      </main>
    </div>
  );
}
