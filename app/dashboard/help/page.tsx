import { redirect } from "next/navigation";
import { UsersRound, Upload, Eye, CheckCircle2, XCircle } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import Navbar from "@/components/Navbar";

type RoleGuide = {
  icon: typeof UsersRound;
  tagline: string;
  canDo: string[];
  cannotDo?: string[];
};

// Kept as plain data next to the page that renders it, not merged into
// lib/rbac.ts's PERMISSIONS matrix — this is prose for humans to read, not
// a check any code path evaluates, and several of the things described
// here (who can share a document, who can triage feedback on it) are
// document-ownership rules rather than a role check, so they don't have a
// PERMISSIONS entry to summarize in the first place. Deliberately has no
// entry for "superadmin" — this page answers "what can I do with MY
// account," and a superadmin's own account management isn't something this
// page documents. Cross-checked against lib/rbac.ts, the share/feedback API
// routes, and app/api/documents/[id]/route.ts's own canEdit/delete checks
// at the time this was written — if those rules change, update this too,
// same as ROLE_DESCRIPTIONS.
const ROLE_GUIDES: Partial<Record<Role, RoleGuide>> = {
  manager: {
    icon: UsersRound,
    tagline: "Owns the review pipeline and day-to-day document lifecycle.",
    canDo: [
      "Upload documents and edit their own uploads",
      "Approve or reject a review assigned to them, with required comments on a rejection",
      "On approval: decide whether to announce the publish to everyone, allow feedback, and allow public sharing — all three are required choices, none can be skipped",
      "Reassign a review to another manager, or bring in additional managers for a second/third opinion",
      "Delete a document outright, revoke a published one back into review, and archive/restore/extend/mark-permanent",
      "View and restore Deleted documents",
      "Manage Categories, Settings, and Announcements",
      "View the Audit Log and Analytics dashboard",
      "Turn a document's sharing or feedback setting on/off later from its Manage tab, and triage (accept/close, with a reply note) feedback left on any document",
    ],
    cannotDo: ["Manage users, designations, or teams"],
  },
  contributor: {
    icon: Upload,
    tagline: "Uploads and maintains their own documents.",
    canDo: [
      "Upload a document for review, into any category, to any manager",
      "Upload a new version of an existing document (goes through review again)",
      "Edit their own uploads (title, tags, category, details)",
      "Delete their own upload while it's still pending review (not once it's published — that needs a manager)",
      "View, download, and search published documents, same as everyone",
      "On a document they uploaded: turn its sharing or feedback setting on/off, and triage feedback left on it",
      "Leave feedback on any document that has feedback enabled, and create a share link for any document that has sharing enabled",
    ],
    cannotDo: ["Approve or reject reviews, or delete/revoke/archive a published document"],
  },
  user: {
    icon: Eye,
    tagline: "View-only access to everything published.",
    canDo: [
      "View, download, and search every published document",
      "Leave feedback on a document that has feedback enabled",
      "Create and manage a public share link for a document that has sharing enabled — sharing isn't restricted to uploaders/managers, any signed-in user who can view the document can share it",
      "See in-app notifications and the team-wide Announcements ticker",
      "Reset their own password (Forgot Password on the sign-in screen) without anyone's help",
    ],
    cannotDo: ["Upload documents, or take any review/admin action"],
  },
};

export default async function HelpGuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const guide = ROLE_GUIDES[user.role];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar
        role={user.role}
        userName={user.name}
        userEmail={user.email}
        userDesignation={user.designation?.name}
        userTeam={user.team?.name}
        userReportsTo={user.reportsTo?.name}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-8 animate-fade-in">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">What You Can Do</h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          Based on your role: <span className="font-semibold text-ff-text">{ROLE_LABELS[user.role]}</span>
        </p>

        {guide ? (
          <div className="rounded-ff border border-ff-border bg-white p-5 shadow-ff">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ff-lavender text-ff-accent">
                <guide.icon className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="text-base font-bold text-ff-text">{ROLE_LABELS[user.role]}</h2>
            </div>
            <p className="mb-3 pl-10 text-xs text-ff-textMuted">{guide.tagline}</p>

            <ul className="mb-3 space-y-1.5 pl-10 text-sm text-ff-text">
              {guide.canDo.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ff-success" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {guide.cannotDo && guide.cannotDo.length > 0 && (
              <ul className="space-y-1.5 pl-10 text-sm text-ff-textMuted">
                {guide.cannotDo.map((item) => (
                  <li key={item} className="flex gap-2">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ff-danger/70" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-ff border border-ff-border bg-white p-5 text-sm text-ff-textMuted shadow-ff">
            Full administrative access to the app — see Admin → Manage Users, Categories, Settings, and Announcements.
          </div>
        )}
      </main>
    </div>
  );
}
