import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { documentAccessWhere } from "@/lib/access";
import { everApprovedVersionIds } from "@/lib/versionRounds";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";

// Archived documents, for everyone who could see them while they were
// published (team documents only to their teams, lib/access.ts). View and
// preview only: downloads and sharing are off for every archived document
// (app/api/documents/[id]/download/route.ts). Documents archived without
// ever being published aren't listed, since only their reviewers can open
// them.
export default async function ArchivedDocumentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const docs = await prisma.document.findMany({
    where: { AND: [{ status: "archived", deletedAt: null, currentVersionId: { not: null } }, documentAccessWhere(user)] },
    include: {
      category: { select: { name: true, isSystem: true } },
      uploadedBy: { select: { name: true } },
      currentVersion: { select: { previewPdfPath: true } },
      versions: { select: { id: true, versionNumber: true, uploadedAt: true } },
      reviewRequests: { select: { roundNumber: true, status: true, comments: true, createdAt: true, reviewerId: true } },
      teamAccess: { select: { team: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows: DocRow[] = docs
    .filter((d) => everApprovedVersionIds(d.versions, d.reviewRequests, d.revokedAt).has(d.currentVersionId!))
    .map((d) => ({
      id: d.id,
      title: d.title,
      categoryName: d.category.isSystem ? d.teamAccess.map((t) => t.team.name).sort().join(", ") : d.category.name,
      docType: d.docType,
      status: d.status,
      uploadedByName: d.uploadedBy.name,
      updatedAt: d.updatedAt.toISOString(),
      isStale: false,
      hasCurrentVersion: true,
      hasPreviewPdf: Boolean(d.currentVersion?.previewPdfPath),
      externalUrl: d.externalUrl,
      visibility: d.visibility,
      accessTeamNames: d.teamAccess.map((t) => t.team.name).sort(),
      downloadable: false,
      note: d.archiveNote,
    }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ff-textMuted hover:text-ff-accent"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Home
          </Link>
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ff-text">
              Archived documents
              <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-xs font-medium text-ff-accent">{rows.length}</span>
            </h1>
            <p className="mt-0.5 text-sm text-ff-textMuted">Out of circulation. You can view them, but not download or share them.</p>
          </div>
          {rows.length === 0 ? (
            <div className="rounded-ff border border-dashed border-ff-border bg-white p-8 text-center text-sm text-ff-textMuted">
              No archived documents.
            </div>
          ) : (
            <DocumentTable rows={rows} />
          )}
        </div>
        <Footer />
      </main>
    </div>
  );
}
