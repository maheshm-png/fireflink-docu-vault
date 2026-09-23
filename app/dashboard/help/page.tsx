import { redirect } from "next/navigation";
import { ShieldCheck, UsersRound, Upload, Eye, CheckCircle2, XCircle } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Badge from "@/components/Badge";

type RoleGuide = {
  role: Role;
  icon: typeof ShieldCheck;
  tagline: string;
  canDo: string[];
  cannotDo?: string[];
};

// Kept as plain data next to the page that renders it, not merged into
// lib/rbac.ts's PERMISSIONS matrix — this is prose for humans to read, not
// a check any code path evaluates, and several of the things described
// here (who can share a document, who can triage feedback on it) are
// document-ownership rules rather than a role check, so they don't have a
// PERMISSIONS entry to summarize in the first place. Cross-checked against
// lib/rbac.ts, the share/feedback API routes, and app/api/documents/[id]/
// route.ts's own canEdit/delete checks at the time this was written — if
// those rules change, update this list too, same as ROLE_DESCRIPTIONS.
const ROLE_GUIDES: RoleGuide[] = [
  {
    role: "superadmin",
    icon: ShieldCheck,
    tagline: "Runs the org: people, structure, and org-wide configuration.",
    canDo: [
      "Invite new users (email invite link, or set a password directly and hand it over yourself)",
      "Change anyone's role, deactivate or reactivate an account, and reset someone's password directly",
      "Assign each user's Designation (job title), Team, and who they report to",
      "Manage the Designation and Team option lists themselves (Admin → Designations / Teams)",
      "Manage Categories, including each category's custom upload form fields and review-cycle length",
      "Post, edit, and take down team-wide Announcements",
      "Configure retention Settings (how long deleted documents and superseded versions are kept before permanent purge)",
      "View the full Audit Log and the Analytics dashboard",
      "View and restore Deleted documents",
      "Upload documents and edit their own uploads, same as a Contributor",
      "Revoke a published document back into review, archive/restore/extend/mark-permanent, and dismiss a false-positive duplicate flag",
    ],
    cannotDo: [
      "Approve or reject a review, or delete a document outright — that stays with Manager on purpose, even for Superadmin",
    ],
  },
  {
    role: "manager",
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
    cannotDo: ["Manage users, designations, or teams — that stays with Superadmin"],
  },
  {
    role: "contributor",
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
  {
    role: "user",
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
];

export default async function HelpGuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The viewer's own role first, so the thing most relevant to them doesn't
  // require scrolling — the rest stay listed below for reference (knowing
  // what a Manager or Superadmin can do explains why, say, a Contributor's
  // upload needs someone else's approval before it's visible to anyone).
  const ordered = [...ROLE_GUIDES].sort((a, b) => (a.role === user.role ? -1 : b.role === user.role ? 1 : 0));

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
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Roles & Features</h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          What each role can do in Docu Vault. Yours is shown first.
        </p>

        <div className="space-y-4">
          {ordered.map((guide) => {
            const Icon = guide.icon;
            const isYou = guide.role === user.role;
            return (
              <div
                key={guide.role}
                className={`rounded-ff border bg-white p-5 shadow-ff ${
                  isYou ? "border-ff-accent/50 ring-1 ring-ff-accent/20" : "border-ff-border"
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ff-lavender text-ff-accent">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <h2 className="text-base font-bold text-ff-text">{ROLE_LABELS[guide.role]}</h2>
                  {isYou && <Badge variant="accent">Your role</Badge>}
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
            );
          })}
        </div>
      </main>
    </div>
  );
}
