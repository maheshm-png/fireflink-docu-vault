import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import { getAppSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import SettingsForm from "./SettingsForm";
import CategoryReviewCycles from "./CategoryReviewCycles";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageSettings")) redirect("/dashboard");

  const [settings, categories] = await Promise.all([
    getAppSettings(),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, reviewCycleDays: true } }),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-3xl px-6 py-8 animate-fade-in space-y-6">
        <div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Settings</h1>
          <p className="text-sm text-ff-textMuted">Org-wide review and retention behavior.</p>
        </div>

        <CategoryReviewCycles categories={categories} />

        <SettingsForm
          initialDeletedDocRetentionDays={settings.deletedDocRetentionDays}
          initialOldVersionRetentionDays={settings.oldVersionRetentionDays}
        />
        </div>
      </main>
    </div>
  );
}
