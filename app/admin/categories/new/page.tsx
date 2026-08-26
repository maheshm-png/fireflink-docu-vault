import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import CategoryFormBuilder from "../CategoryFormBuilder";

export default async function NewCategoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageCategories")) redirect("/dashboard");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-ff-text">New Category</h1>
        <CategoryFormBuilder mode="create" />
        </div>
      </main>
    </div>
  );
}
