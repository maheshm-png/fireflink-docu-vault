import { redirect } from "next/navigation";
import { UsersRound, Upload, Eye, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { WorkflowChart, type FlowNode } from "./WorkflowChart";

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
      "On approval: decide whether to announce the publish to everyone, allow feedback, and allow public sharing, all three are required choices, none can be skipped",
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
      "Delete their own upload while it's still pending review (not once it's published, that needs a manager)",
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
      "Create and manage a public share link for a document that has sharing enabled, sharing isn't restricted to uploaders/managers, any signed-in user who can view the document can share it",
      "See in-app notifications and the team-wide Announcements ticker",
      "Reset their own password (Forgot Password on the sign-in screen) without anyone's help",
    ],
    cannotDo: ["Upload documents, or take any review/admin action"],
  },
};

// RACI (Responsible/Accountable/Consulted/Informed) per stage, cross-checked
// against the same sources as ROLE_GUIDES above — a field is left out of a
// given stage's `raci` object where it genuinely doesn't apply (e.g. no one
// is "consulted" before a self-service password reset) rather than filled
// with a placeholder.
const PUBLISH_FLOW: FlowNode[][] = [
  [
    {
      label: "Upload",
      note: "Contributor, Manager, or Superadmin",
      tone: "start",
      detail:
        "The uploader picks a category, fills in that category's fields, attaches the file, and chooses which Manager should review it. The document lands directly in Pending Review, nothing is visible to anyone else yet.",
      raci: { responsible: "Uploader", accountable: "Uploader", informed: "The Manager chosen as reviewer" },
    },
  ],
  [
    {
      label: "Pending Review",
      note: "Sent to the chosen reviewer",
      tone: "neutral",
      detail:
        "The document sits with the assigned Manager until they act on it. The Manager can loop in one or more additional Managers for a second opinion before deciding.",
      raci: {
        responsible: "Assigned Manager",
        accountable: "Assigned Manager",
        consulted: "Any additional Managers brought in",
        informed: "Uploader",
      },
    },
  ],
  [
    {
      label: "Approved",
      note: "Manager publishes it",
      tone: "success",
      detail:
        "The reviewing Manager approves and, in the same step, must decide whether to announce the publish to everyone, allow feedback, and allow public sharing. All three choices are required, none can be skipped.",
      raci: {
        responsible: "Reviewing Manager",
        accountable: "Reviewing Manager",
        informed: "Uploader, and everyone else if the publish is announced",
      },
    },
    {
      label: "Rejected",
      note: "Comments required; uploader fixes and resubmits",
      tone: "danger",
      detail:
        "The reviewing Manager rejects with required comments on what needs to change. The document goes back to the uploader, who edits it and resubmits for another round of review.",
      raci: { responsible: "Reviewing Manager", accountable: "Reviewing Manager", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Published",
      note: "Visible to everyone",
      tone: "success",
      detail:
        "The document is now visible to every signed-in user in search and listings, with whatever feedback and sharing settings were chosen at approval.",
      raci: { responsible: "Reviewing Manager", accountable: "Reviewing Manager", informed: "All users, if announced" },
    },
  ],
];

const POST_PUBLISH_FLOW: FlowNode[][] = [
  [
    {
      label: "Published",
      tone: "success",
      detail: "A live document isn't locked in place, any Manager can still revoke, archive, or delete it whenever the situation calls for it.",
      raci: { responsible: "Any Manager", accountable: "Any Manager", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Revoked",
      note: "Pulled back into review, needs approval again",
      tone: "warn",
      detail: "Pulled back out of the published list and returned to Pending Review. It needs to be approved again before anyone can see it.",
      raci: { responsible: "Manager who revokes it", accountable: "Manager who revokes it", informed: "Uploader" },
    },
    {
      label: "Archived",
      note: "Retired, no longer active",
      tone: "neutral",
      detail: "Retired from active use without deleting it. A Manager can restore it, extend it, or mark it permanent later.",
      raci: { responsible: "Manager", accountable: "Manager", informed: "Uploader" },
    },
    {
      label: "Deleted",
      note: "Recoverable for a set number of days, then purged",
      tone: "danger",
      detail: "Removed from view but recoverable from the Deleted list for a set number of days before it's purged for good.",
      raci: { responsible: "Manager", accountable: "Manager", informed: "Uploader" },
    },
  ],
];

const FEEDBACK_FLOW: FlowNode[][] = [
  [
    {
      label: "Anyone views the document",
      tone: "start",
      detail:
        "Any signed-in user who can see the document can leave feedback, but only when the publishing Manager (or the uploader afterward) has feedback turned on for it.",
      raci: { responsible: "Any signed-in viewer" },
    },
  ],
  [
    {
      label: "Leaves feedback",
      note: "Optionally tags the uploader or a reviewer",
      tone: "neutral",
      detail: "The viewer writes a note and can optionally tag the uploader or a specific reviewer to point it at them directly.",
      raci: { responsible: "Viewer leaving the feedback", informed: "Uploader and/or tagged reviewer" },
    },
  ],
  [
    {
      label: "Accepted",
      note: "Manager or uploader, with an optional reply note",
      tone: "success",
      detail: "The uploader or a Manager marks the feedback accepted, with an optional reply note on what was done about it.",
      raci: { responsible: "Uploader or Manager", accountable: "Uploader or Manager", informed: "Person who left the feedback" },
    },
    {
      label: "Closed",
      note: "Dismissed, with an optional reply note",
      tone: "neutral",
      detail: "Dismissed without action, also with an optional reply note. Used when the feedback doesn't need a change.",
      raci: { responsible: "Uploader or Manager", accountable: "Uploader or Manager", informed: "Person who left the feedback" },
    },
  ],
  [
    {
      label: "Author is notified",
      tone: "start",
      detail: "Whoever left the feedback is notified once it's triaged, so they know it wasn't just left unread.",
      raci: { informed: "Person who left the feedback" },
    },
  ],
];

const SHARE_FLOW: FlowNode[][] = [
  [
    {
      label: "Sharing turned on",
      note: "At publish, or later from Manage",
      tone: "start",
      detail: "Decided by the Manager at publish time, or flipped on later from the document's Manage tab by a Manager or the uploader.",
      raci: { responsible: "Manager (at publish) or uploader (later)", accountable: "Manager" },
    },
  ],
  [
    {
      label: "Create a share link",
      note: "View-only or view + download, optional expiry",
      tone: "neutral",
      detail:
        "Any signed-in user who can view the document (not just the uploader or a Manager) can generate a link, choosing view-only or view + download and an optional expiry date.",
      raci: { responsible: "Any signed-in viewer of the document", accountable: "Person who creates the link" },
    },
  ],
  [
    {
      label: "Anyone with the link",
      note: "No sign-in needed",
      tone: "success",
      detail: "The link works for anyone, no account or sign-in required, until it's turned off or it expires.",
      raci: { informed: "Nobody automatically, the link creator should track who they sent it to" },
    },
  ],
  [
    {
      label: "Turned off anytime",
      note: "Link stops working immediately",
      tone: "danger",
      detail: "A Manager or the uploader can disable sharing from the Manage tab at any point; every existing link for that document stops working immediately.",
      raci: { responsible: "Manager or uploader", accountable: "Manager or uploader" },
    },
  ],
];

const PASSWORD_RESET_FLOW: FlowNode[][] = [
  [
    {
      label: "Forgot Password",
      note: "On the sign-in screen",
      tone: "start",
      detail: "Started from the sign-in screen, no admin involvement needed.",
      raci: { responsible: "The user" },
    },
  ],
  [
    {
      label: "Enter your email",
      tone: "neutral",
      detail:
        "If the address matches an active account, a one-time code is emailed to it. If it doesn't match anything, the user is told right away instead of being sent on to a verification step.",
      raci: { responsible: "The user" },
    },
  ],
  [
    {
      label: "Code emailed to you",
      note: "Expires after 10 minutes",
      tone: "neutral",
      detail: "The code expires after 10 minutes. Requesting a new one invalidates the previous code.",
      raci: { informed: "The user, by email" },
    },
  ],
  [
    {
      label: "Enter code + new password",
      tone: "neutral",
      detail: "The user enters the code and sets a new password, with show/hide toggles so they can check what they typed before submitting.",
      raci: { responsible: "The user" },
    },
  ],
  [
    {
      label: "Signed in",
      tone: "success",
      detail: "The new password takes effect immediately and the user is signed in with it.",
      raci: { responsible: "The user" },
    },
  ],
];

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
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 animate-fade-in">
        <div className="space-y-10">
          <section className="max-w-5xl">
            <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">What You Can Do</h1>
            <p className="mb-6 text-sm text-ff-textMuted">
              Based on your role: <span className="font-semibold text-ff-text">{ROLE_LABELS[user.role]}</span>
            </p>

            {guide ? (
              <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
                <div className="flex items-center gap-3 border-b border-ff-border bg-ff-lavender/30 px-5 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ff-accent text-white shadow-ff">
                    <guide.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-ff-text">{ROLE_LABELS[user.role]}</h2>
                    <p className="text-xs text-ff-textMuted">{guide.tagline}</p>
                  </div>
                </div>

                {/* Centered as a group, each card sized to its own content
                    (not stretched to fill the section's full width) — a
                    short "Cannot Do" list now reads as its own compact card
                    sitting next to a bigger one, both in the middle of the
                    section, rather than two halves stretched edge to edge
                    with empty space inside the shorter one. */}
                <div className="flex flex-wrap items-start justify-center gap-4 p-5">
                  <div className="w-full rounded-ff border border-ff-success/25 bg-ff-success/5 p-4 sm:w-auto sm:max-w-xl">
                    <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ff-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Can Do
                    </h3>
                    <ul className="space-y-2.5 text-sm text-ff-text">
                      {guide.canDo.map((item) => (
                        <li key={item} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ff-success" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="w-full rounded-ff border border-ff-border bg-ff-lavender/20 p-4 sm:w-auto sm:max-w-xs">
                    <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ff-textMuted">
                      <XCircle className="h-3.5 w-3.5" aria-hidden />
                      Cannot Do
                    </h3>
                    {guide.cannotDo && guide.cannotDo.length > 0 ? (
                      <ul className="space-y-2.5 text-sm text-ff-textMuted">
                        {guide.cannotDo.map((item) => (
                          <li key={item} className="flex gap-2">
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ff-danger/60" aria-hidden />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm italic text-ff-textMuted">Nothing restricted beyond standard access controls.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff">
                <div className="flex items-center gap-3 border-b border-ff-border bg-ff-lavender/30 px-5 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ff-accent text-white shadow-ff">
                    <ShieldCheck className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-ff-text">{ROLE_LABELS[user.role]}</h2>
                    <p className="text-xs text-ff-textMuted">Full administrative access across the app.</p>
                  </div>
                </div>
                <p className="p-5 text-sm text-ff-text">
                  See Admin → Manage Users, Categories, Settings, and Announcements.
                </p>
              </div>
            )}
          </section>

          <section className="max-w-5xl">
            <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">How Things Work</h1>
            <p className="mb-6 text-sm text-ff-textMuted">The workflow behind each major feature.</p>

            <div className="space-y-4">
              <WorkflowChart
                title="Getting a document published"
                description="Every upload goes through one specific reviewer before anyone else can see it."
                steps={PUBLISH_FLOW}
              />

              <WorkflowChart
                title="After it's published"
                description="A published document isn't the end of the line, a Manager can still act on it."
                steps={POST_PUBLISH_FLOW}
              />

              <WorkflowChart
                title="Feedback on a document"
                description="Only when the publishing Manager (or the doc's uploader afterward) has feedback turned on."
                steps={FEEDBACK_FLOW}
              />

              <WorkflowChart
                title="Sharing a document publicly"
                description="Only when sharing is turned on for that document, decided at publish time, changeable anytime after."
                steps={SHARE_FLOW}
              />

              <WorkflowChart
                title="Forgot your password"
                description="Fully self-service, no admin needed."
                steps={PASSWORD_RESET_FLOW}
              />
            </div>
          </section>
        </div>
        </div>

        {/* Siblings of the content div above, not nested inside it — same
            "own mx-auto max-w-7xl px-6, not another content card" footer
            pattern every other dashboard page uses (see components/Footer.tsx). */}
        <p className="mx-auto mt-10 w-full max-w-7xl px-6 text-center text-sm text-ff-textMuted">
          Still need help? Email{" "}
          <a href="mailto:docuvault@fireflink.com" className="font-medium text-ff-accent hover:underline">
            docuvault@fireflink.com
          </a>
        </p>
        <Footer />
      </main>
    </div>
  );
}
