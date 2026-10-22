import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import AssistantPageChat from "@/components/assistant/AssistantPageChat";

export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex min-h-0 flex-1 flex-col animate-fade-in">
        <AssistantPageChat />
      </main>
    </div>
  );
}
