import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";
import { prisma } from "@/lib/prisma";
import type { CategoryFormField } from "@/lib/formSchema";

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Plain view-only "User" role never uploads, so category upload-form
  // details aren't relevant to them (also hidden from their nav — see
  // components/Navbar.tsx). Everyone who does upload (sc and up) can view
  // what categories exist and what each one's form asks for, so they can
  // pick the right one; only managers/superadmins can create or edit one.
  if (user.role === "user") redirect("/dashboard");
  const canManage = can(user.role, "manageCategories");

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
              Categories
              <InfoTooltip text="Each category can have its own upload form. Set the questions uploaders must answer so anyone opening a document later has the context without chasing anyone down." />
            </h1>
            <p className="text-sm text-ff-textMuted">Organize documents by category and upload form.</p>
          </div>
          {canManage && (
            <Link
              href="/admin/categories/new"
              className="shrink-0 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105"
            >
              New Category
            </Link>
          )}
        </div>

        <div className="space-y-3">
          {categories.length === 0 && (
            <div className="rounded-ff border border-ff-border bg-white p-6 text-center text-sm text-ff-textMuted">
              No categories yet. Create the first one to start organizing uploads.
            </div>
          )}
          {categories.map((c) => {
            const fields = (c.formSchema as unknown as CategoryFormField[]) ?? [];
            return (
              <div key={c.id} className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-ff-text">{c.name}</div>
                    {c.description && (
                      <p className="max-w-2xl break-words text-sm text-ff-textMuted">{c.description}</p>
                    )}
                    <p className="mt-1 text-xs text-ff-textMuted">
                      {c.reviewCycleDays === null
                        ? "No review cycle (documents are permanent by default)"
                        : `Review cycle: every ${c.reviewCycleDays} days`}
                    </p>
                    <p className="mt-1 max-w-2xl break-words text-xs text-ff-textMuted">
                      {fields.length === 0
                        ? "No custom upload form"
                        : (
                          <>
                            Asks for: {fields.map((f) => `${f.label}${f.required ? " *" : ""}`).join(", ")}
                          </>
                        )}
                    </p>
                  </div>
                  {canManage && (
                    <Link
                      href={`/admin/categories/${c.id}/edit`}
                      className="shrink-0 text-sm text-ff-accent hover:underline"
                    >
                      Edit
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </main>
    </div>
  );
}
