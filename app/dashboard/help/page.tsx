import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import { ROLE_LABELS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ORG_LEVEL, TEAM_LEVEL, TEAM_ROLE_LABEL } from "@/lib/roleCopy";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { WorkflowChart, type FlowNode } from "./WorkflowChart";

// What THIS person can do, in plain sentences, built from their org role,
// their role in each team, and the Global approver / Sees all teams flags.
// Prose for humans: the rules live in lib/rbac.ts and lib/access.ts; if those
// change, update this too.
type AccessFacts = {
  role: string;
  isGlobalApprover: boolean;
  seesAllTeams: boolean;
  viewTeamNames: string[];
  teams: { name: string; role: "member" | "contributor" | "manager" }[];
};

function whatYouCanDo(u: AccessFacts): { heading: string; items: string[] }[] {
  const groups: { heading: string; items: string[] }[] = [];
  const everyone = [
    "View, search and download published documents",
    "Share documents with customers by link, when sharing is on for that document",
    "Leave feedback, when feedback is on for that document",
  ];
  if (u.role === "contributor" || u.role === "manager" || u.role === "superadmin") {
    everyone.push(
      u.role === "manager"
        ? "Upload documents for everyone. Send them to a reviewer, or publish your own straight away with No review needed"
        : "Upload documents for everyone. A manager reviews each one before anyone else sees it",
      "Edit your own uploads and upload new versions of them"
    );
  }
  if (u.role === "manager") {
    everyone.push(
      "Approve or reject uploads sent to you, with comments when you reject",
      "Archive, restore or delete documents you uploaded or reviewed"
    );
  }
  if (u.isGlobalApprover && u.role === "manager") {
    everyone.push(
      "Review uploads from any team when you're picked as their reviewer (you're the Global approver). You see only the team documents assigned to you",
      "Decide when a team asks for one of its documents to be visible to everyone"
    );
  }
  if (u.role === "superadmin") {
    everyone.push(
      "Add and manage people, teams, categories and settings",
      "See every team's documents, and archive or restore any document"
    );
  }
  groups.push({ heading: "Documents for everyone", items: everyone });

  for (const t of u.teams) {
    const items = [`View, download and search ${t.name}'s documents`];
    if (t.role === "contributor" || t.role === "manager") {
      items.push(
        t.role === "manager"
          ? `Upload for ${t.name}. Send to a reviewer, or publish straight away with No review needed`
          : `Upload for ${t.name}. A ${t.name} manager reviews it`,
        "Pick a folder for your upload"
      );
    }
    if (t.role === "manager") {
      items.push(
        `Approve or reject ${t.name} uploads sent to you`,
        `Create, rename and delete ${t.name}'s folders, and move documents between them`,
        `Ask for a ${t.name} document to be visible to everyone`
      );
    }
    groups.push({ heading: `${t.name} (${t.role.charAt(0).toUpperCase()}${t.role.slice(1)})`, items });
  }

  const leaderView = u.seesAllTeams
    ? "View, download and comment on every team's documents"
    : u.viewTeamNames.length
      ? `View, download and comment on ${u.viewTeamNames.join(", ")} documents`
      : null;
  const otherTeams = [
    ...(leaderView ? [leaderView] : []),
    ...(u.role === "contributor" || u.role === "manager"
      ? ["Upload into a team you're not in. Its manager reviews it, and you see only your own upload there"]
      : []),
  ];
  if (otherTeams.length) groups.push({ heading: "Other teams", items: otherTeams });
  return groups;
}

// RACI (Responsible/Accountable/Consulted/Informed) per stage, cross-checked
// against the same sources as the access tables above — a field is left out of a
// given stage's `raci` object where it genuinely doesn't apply (e.g. no one
// is "consulted" before a self-service password reset) rather than filled
// with a placeholder.
const PUBLISH_FLOW: FlowNode[][] = [
  [
    {
      label: "Upload",
      note: "Contributor or Manager",
      tone: "start",
      detail:
        "Pick a category, fill in its fields, attach the file, choose Everyone, and pick the Manager who should review it. Nobody else sees it yet.",
      raci: { responsible: "Uploader", accountable: "Uploader", informed: "The Manager chosen as reviewer" },
    },
  ],
  [
    {
      label: "In review",
      note: "Waiting on the reviewer",
      tone: "neutral",
      detail:
        "It shows in the reviewer's My Work > Waiting on me. The reviewer can bring in more Managers for a second opinion, or hand it to another Manager.",
      raci: { responsible: "Reviewing Manager", accountable: "Reviewing Manager", consulted: "Managers brought in", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Approved",
      note: "Published for everyone",
      tone: "success",
      detail:
        "On approval the reviewer confirms downloads, customer share links, feedback and notifications. One click fills in the usual answers. Everyone in FireFlink can now find it on Home.",
      raci: { responsible: "Reviewing Manager", accountable: "Reviewing Manager", informed: "Uploader, and everyone if notified" },
    },
    {
      label: "Rejected",
      note: "Comments required",
      tone: "danger",
      detail:
        "The reviewer says what needs to change. The uploader uploads a new version, which starts the next review round with the same reviewer.",
      raci: { responsible: "Reviewing Manager", accountable: "Reviewing Manager", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Manager shortcut",
      note: "No review needed",
      tone: "warn",
      detail:
        "A Manager uploading their own document may tick No review needed. It publishes straight away and carries a Review Bypassed label, so everyone can tell. Contributors never get this option.",
      raci: { responsible: "Uploading Manager", accountable: "Uploading Manager" },
    },
  ],
];

const TEAM_FLOW: FlowNode[][] = [
  [
    {
      label: "Upload for your team",
      note: "Team Contributor or Manager",
      tone: "start",
      detail:
        "Choose Restricted to teams and tick your team. If your role only lets you upload for your team (for example Sales), Everyone is greyed out. You can pick a folder too. Org Contributors and Managers can also upload into a team they aren't in; they then see only that one document there.",
      raci: { responsible: "Uploader", accountable: "Uploader", informed: "The team Manager chosen as reviewer" },
    },
  ],
  [
    {
      label: "Team Manager reviews",
      note: "Same rules as any review",
      tone: "neutral",
      detail:
        "Only Managers of that team can be picked as reviewer. They approve, or reject with comments and a new version starts the next round. A team Manager's own upload may skip review with No review needed.",
      raci: { responsible: "Team Manager", accountable: "Team Manager", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Visible to the team only",
      note: "Home > My teams",
      tone: "success",
      detail:
        "Only the team's members see it, plus superadmins and anyone with Sees all teams. It stays out of everyone else's search, AI answers and notifications, and can't be shared outside the company.",
      raci: { responsible: "Team Manager", accountable: "Team Manager", informed: "Team members, if notified" },
    },
  ],
];

const EVERYONE_REQUEST_FLOW: FlowNode[][] = [
  [
    {
      label: "Request for Everyone",
      note: "Team Manager, from the Manage tab",
      tone: "start",
      detail: "When a team document should be visible to the whole company, a team Manager asks for it with a reason.",
      raci: { responsible: "Team Manager", accountable: "Team Manager", informed: "Global approver" },
    },
  ],
  [
    {
      label: "Global approver decides",
      note: "One Manager picked by the superadmin",
      tone: "neutral",
      detail: "It shows in their My Work > Waiting on me. They can open the document to read it before deciding.",
      raci: { responsible: "Global approver", accountable: "Global approver" },
    },
  ],
  [
    {
      label: "Opened to everyone",
      tone: "success",
      detail: "The document moves to Home > Everyone, and the team Manager is told.",
      raci: { responsible: "Global approver", accountable: "Global approver", informed: "Team Manager who asked" },
    },
    {
      label: "Sent back",
      note: "Comment required",
      tone: "danger",
      detail: "It stays with the team, and the team Manager sees the comment on the Manage tab.",
      raci: { responsible: "Global approver", accountable: "Global approver", informed: "Team Manager who asked" },
    },
  ],
];

const FOLDERS_FLOW: FlowNode[][] = [
  [
    {
      label: "Create folders",
      note: "Team Managers",
      tone: "start",
      detail: "On Home > My teams, pick your team and use New folder. Rename or delete the open folder from the same bar. Deleting a folder keeps its documents.",
      raci: { responsible: "Team Manager", accountable: "Team Manager" },
    },
  ],
  [
    {
      label: "File documents",
      note: "At upload, or from Manage",
      tone: "neutral",
      detail: "The uploader can pick a folder when uploading for one team. A team Manager can move any team document from its Manage tab.",
      raci: { responsible: "Uploader or Team Manager", accountable: "Team Manager" },
    },
  ],
  [
    {
      label: "Browse and search",
      note: "Everyone in the team",
      tone: "success",
      detail: "Click a folder to see what's in it. The search box above the list looks through titles, tags and the text inside the team's files.",
      raci: { responsible: "Any team member" },
    },
  ],
];

const POST_PUBLISH_FLOW: FlowNode[][] = [
  [
    {
      label: "Published",
      tone: "success",
      detail: "A live document isn't locked in place. The Manager who approved it (or anyone added as its reviewer) can still archive or delete it. Other Managers can only view it.",
      raci: { responsible: "Approving Manager", accountable: "Approving Manager", informed: "Uploader" },
    },
  ],
  [
    {
      label: "Archived",
      note: "Taken out of circulation",
      tone: "neutral",
      detail:
        "Hidden from everyone. If it was published, everyone who could see it is told to stop using it. A Manager can restore it, which sends it back for approval before it's visible again.",
      raci: { responsible: "Manager", accountable: "Manager", informed: "Everyone who could see it" },
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
      detail: "Decided by the Manager at publish time, or flipped on later from the document's Manage tab by a Manager or the uploader. Only documents for Everyone can be shared: team documents stay inside the company.",
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

/** A titled group of step-by-step guides on the Help page. */
function GuideGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 border-b border-ff-border pb-1.5 text-xs font-bold uppercase tracking-wide text-ff-textMuted">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default async function HelpGuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const myTeams = await prisma.team.findMany({
    where: { id: { in: user.teamIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const viewTeams = user.viewTeamIds.length
    ? await prisma.team.findMany({ where: { id: { in: user.viewTeamIds } }, orderBy: { name: "asc" }, select: { name: true } })
    : [];
  // Which step-by-step guides apply to this person.
  const canUploadForEveryone = ["contributor", "manager", "superadmin"].includes(user.role);
  const inATeam = myTeams.length > 0;
  const managesATeam = myTeams.some((t) => user.teamRoles[t.id] === "manager");
  const decidesEveryone = user.isGlobalApprover && user.role === "manager";
  const isManager = user.role === "manager" || managesATeam;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar
        role={user.role}
        userName={user.name}
        userEmail={user.email}
        userTeam={user.team?.name}
        userReportsTo={user.reportsTo?.name}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 animate-fade-in">
        <div className="space-y-10">
          <section className="max-w-3xl">
            <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">My permissions</h1>
            <p className="mb-6 text-sm text-ff-textMuted">
              {ORG_LEVEL.title}: <strong className="text-ff-text">{ROLE_LABELS[user.role]}</strong>
              {myTeams.length > 0 && (
                <>
                  {" "}
                  &middot; {TEAM_LEVEL.title}:{" "}
                  <strong className="text-ff-text">
                    {myTeams.map((t) => `${t.name} (${TEAM_ROLE_LABEL[user.teamRoles[t.id] ?? "member"]})`).join(", ")}
                  </strong>
                </>
              )}
            </p>

            <div className="space-y-4">
              {whatYouCanDo({
                role: user.role,
                isGlobalApprover: user.isGlobalApprover,
                seesAllTeams: user.seesAllTeams,
                viewTeamNames: viewTeams.map((t) => t.name),
                teams: myTeams.map((t) => ({ name: t.name, role: user.teamRoles[t.id] ?? "member" })),
              }).map((g) => (
                <div key={g.heading} className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
                  <h2 className="mb-2 text-base font-bold text-ff-text">{g.heading}</h2>
                  <ul className="space-y-1.5 text-sm text-ff-text">
                    {g.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ff-success" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {myTeams.length === 0 && user.role !== "superadmin" && (
                <p className="text-sm text-ff-textMuted">You aren&apos;t in a team. A superadmin can add you in People.</p>
              )}
            </div>
          </section>

          <section className="max-w-5xl">
            <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">How it works</h1>
            <p className="mb-6 text-sm text-ff-textMuted">Step by step, for the things you do.</p>

            <div className="space-y-8">
              {(canUploadForEveryone || inATeam) && (
                <GuideGroup title="Uploading">
                  {canUploadForEveryone && (
                    <WorkflowChart title="Publishing a document for everyone" description="Every upload goes to one reviewer before anyone else can see it." steps={PUBLISH_FLOW} />
                  )}
                  {inATeam && (
                    <WorkflowChart title="Publishing a document for your team" description="Same review rules, but only the team ever sees it." steps={TEAM_FLOW} />
                  )}
                </GuideGroup>
              )}

              {(inATeam || decidesEveryone) && (
                <GuideGroup title="Team documents">
                  {inATeam && (
                    <WorkflowChart title="Folders and search" description="Keep a team's documents organised and easy to find." steps={FOLDERS_FLOW} />
                  )}
                  {(managesATeam || decidesEveryone) && (
                    <WorkflowChart title="Opening a team document to everyone" description="Nobody inside a team can do this alone: one Global approver decides." steps={EVERYONE_REQUEST_FLOW} />
                  )}
                </GuideGroup>
              )}

              <GuideGroup title="Using documents">
                  <WorkflowChart title="Sharing with customers" description="Only documents for everyone, and only when sharing is turned on for that document." steps={SHARE_FLOW} />
                  <WorkflowChart title="Leaving feedback" description="Only when feedback is turned on for that document." steps={FEEDBACK_FLOW} />
              </GuideGroup>

              {isManager && (
                <GuideGroup title="Managing documents">
                  <WorkflowChart title="Taking a document down" description="Archive takes it out of circulation; restoring it goes back through review." steps={POST_PUBLISH_FLOW} />
                </GuideGroup>
              )}

              <GuideGroup title="Your account">
                  <WorkflowChart title="Forgot your password" description="Fully self-service, no admin needed." steps={PASSWORD_RESET_FLOW} />
              </GuideGroup>
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
