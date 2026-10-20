import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getAppSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import SettingsForm from "./SettingsForm";
import CategoryReviewCycles from "./CategoryReviewCycles";
import EveryoneApprover from "./EveryoneApprover";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageSettings")) redirect("/dashboard");

  const isSuperadmin = user.role === "superadmin";
  const [settings, categories, managers, approver] = await Promise.all([
    getAppSettings(),
    prisma.category.findMany({ where: { isSystem: false }, orderBy: { name: "asc" }, select: { id: true, name: true, reviewCycleDays: true } }),
    // The Global approver is superadmin-managed and must be an org manager.
    isSuperadmin
      ? prisma.user.findMany({ where: { role: "manager", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isSuperadmin
      ? prisma.user.findFirst({ where: { isGlobalApprover: true }, select: { id: true, name: true, role: true, isActive: true } })
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Settings</h1>
          <p className="text-sm text-ff-textMuted">
            Org-wide review and retention behavior. To add or edit categories and their upload forms, go to{" "}
            <Link href="/admin/categories" className="text-ff-accent hover:underline">
              Categories
            </Link>
            .
          </p>
        </div>

        <CategoryReviewCycles categories={categories} />

        {isSuperadmin && (
          <EveryoneApprover
            managers={managers}
            currentId={approver?.id ?? null}
            currentInvalidName={approver && (approver.role !== "manager" || !approver.isActive) ? approver.name : null}
          />
        )}

        <SettingsForm
          initialDeletedDocRetentionDays={settings.deletedDocRetentionDays}
          initialOldVersionRetentionDays={settings.oldVersionRetentionDays}
        />
        </div>
        </div>
        <Footer />
      </main>
    </div>
  );
}
