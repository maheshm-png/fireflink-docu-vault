import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";
import CategoryFormBuilder from "../../CategoryFormBuilder";
import { prisma } from "@/lib/prisma";
import type { CategoryFormField } from "@/lib/formSchema";

export default async function EditCategoryPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "manageCategories")) redirect("/dashboard");

  const category = await prisma.category.findUniqueOrThrow({ where: { id: params.id } });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
          Edit Category
          <InfoTooltip text="Changes to the upload form only affect future uploads. Existing documents keep the details they were submitted with." />
        </h1>
        <CategoryFormBuilder
          mode="edit"
          categoryId={category.id}
          initial={{
            name: category.name,
            description: category.description ?? "",
            reviewCycleDays: category.reviewCycleDays,
            formSchema: (category.formSchema as unknown as CategoryFormField[]) ?? [],
          }}
        />
        </div>
      </main>
    </div>
  );
}
