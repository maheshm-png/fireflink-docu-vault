import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import UploadForm from "./UploadForm";

export default async function UploadPage({ searchParams }: { searchParams: { category?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "upload")) redirect("/dashboard");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <UploadForm initialCategoryId={searchParams.category} myReportsToId={user.reportsToId} />
    </div>
  );
}
