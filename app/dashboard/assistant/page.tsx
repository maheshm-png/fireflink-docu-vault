import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";

export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-6 py-8 animate-fade-in">
        <h1 className="mb-4 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
          Ask AI
          <InfoTooltip text="Ask about anything in Docu Vault. It searches published documents and answers only from what's actually there." />
        </h1>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-ff border border-ff-border bg-ff-surface-gradient p-4 text-center shadow-ff">
          <Sparkles className="h-10 w-10 text-ff-accent/40" aria-hidden />
          <p className="text-base font-semibold text-ff-text">Coming Soon</p>
          <p className="max-w-sm text-sm text-ff-textMuted">Ask Docu AI isn&apos;t available yet. Check back soon.</p>
        </div>
      </main>
    </div>
  );
}
