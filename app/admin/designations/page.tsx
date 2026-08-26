import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";
import { prisma } from "@/lib/prisma";
import DesignationManager from "./DesignationManager";

export default async function DesignationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageDesignations")) redirect("/dashboard");

  const designations = await prisma.designation.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
            Designations
            <InfoTooltip text="The job-title options offered on each user's profile in Manage Users. Removing one just clears it from anyone currently holding it." />
          </h1>
          <p className="text-sm text-ff-textMuted">Job titles available in Manage Users.</p>
        </div>

        <DesignationManager
          initialDesignations={designations.map((d) => ({ id: d.id, name: d.name, userCount: d._count.users }))}
        />
        </div>
      </main>
    </div>
  );
}
