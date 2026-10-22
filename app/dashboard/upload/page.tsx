import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { canUploadSomething, uploadableTeamIds } from "@/lib/access";
import Navbar from "@/components/Navbar";
import UploadForm from "./UploadForm";

export default async function UploadPage(
  props: {
    searchParams: Promise<{ category?: string; for?: string; team?: string; folder?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canUploadSomething(user)) redirect("/dashboard");

  // Teams this uploader may restrict a document to (lib/access.ts's
  // validateTeamSelection): every team for org contributors, managers and
  // superadmins; otherwise the teams where they are a contributor or manager.
  const allowedTeamIds = uploadableTeamIds(user);
  const teamOptions = await prisma.team.findMany({
    where: allowedTeamIds ? { id: { in: allowedTeamIds } } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Where the Upload button was clicked (Home > Everyone, or a team and
  // folder in My teams): pre-filled when this uploader may use it.
  const initialTeamId = teamOptions.some((t) => t.id === searchParams.team) ? searchParams.team! : null;
  const initialFolderId =
    initialTeamId && searchParams.folder
      ? (await prisma.teamFolder.findFirst({ where: { id: searchParams.folder, teamId: initialTeamId }, select: { id: true } }))?.id ?? null
      : null;
  const initialVisibility: "org" | "restricted" | null = initialTeamId
    ? "restricted"
    : searchParams.for === "everyone" && can(user.role, "upload")
      ? "org"
      : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <UploadForm
        initialCategoryId={searchParams.category}
        initialVisibility={initialVisibility}
        initialTeamId={initialTeamId}
        initialFolderId={initialFolderId}
        myReportsToId={user.reportsToId}
        canBypassReview={user.role === "manager"}
        canUploadForEveryone={can(user.role, "upload")}
        managedTeamIds={user.teamIds.filter((t) => user.teamRoles[t] === "manager")}
        teamOptions={teamOptions}
        myTeamIds={user.teamIds}
      />
    </div>
  );
}
