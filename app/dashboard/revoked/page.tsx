import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import InfoTooltip from "@/components/InfoTooltip";
import DocumentTable, { type DocRow } from "@/components/DocumentTable";
import DocumentGrid from "@/components/DocumentGrid";
import ViewToggle from "@/components/ViewToggle";

// Org-wide, view-only listing of revoked documents — unlike the Review
// Dashboard's "Revoked" tab (app/dashboard/pending/page.tsx), which is
// scoped to just the uploader/assigned reviewer, this page is open to
// every role, including the base "user" role that can't reach the Review
// Dashboard at all. Preview works for everyone (see the "revoked" carve-out
// in app/api/documents/[id]/preview/route.ts); download stays restricted to
// a manager/superadmin or the document's own uploader/owner (see
// app/api/documents/[id]/download/route.ts's canAccessUnpublished, left
// unchanged) — hideDownload below just keeps the button from being shown
// to someone who'd get a 404 clicking it.
export default async function RevokedDocumentsPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const docs = await prisma.document.findMany({
    where: { status: "revoked", deletedAt: null },
    include: {
      category: true,
      uploadedBy: true,
      revokedBy: true,
      currentVersion: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const canDownload = (uploadedById: string, ownerId: string) =>
    user.role === "manager" || user.role === "superadmin" || uploadedById === user.id || ownerId === user.id;

  const rows: DocRow[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    categoryName: doc.category.name,
    docType: doc.docType,
    status: doc.status,
    uploadedByName: doc.uploadedBy.name,
    updatedAt: doc.updatedAt.toISOString(),
    isStale: false,
    hasCurrentVersion: doc.currentVersion !== null,
    hasPreviewPdf: Boolean(doc.currentVersion?.previewPdfPath),
    externalUrl: doc.externalUrl,
    note: [doc.revokedBy ? `Revoked by ${doc.revokedBy.name}` : "Revoked", doc.revokeReason]
      .filter(Boolean)
      .join(": "),
    hideDownload: !canDownload(doc.uploadedById, doc.ownerId),
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-7xl px-6 py-8 animate-fade-in">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-ff-text">
            Revoked Documents
            <InfoTooltip text="Pulled down and awaiting re-approval. Viewable by everyone with the reason it was revoked, but only downloadable by a manager, superadmin, or the document's own uploader." />
          </h1>
          <ViewToggle basePath="/dashboard/revoked" />
        </div>
        {searchParams.view === "grid" ? <DocumentGrid rows={rows} /> : <DocumentTable rows={rows} />}
        </div>
      </main>
    </div>
  );
}
