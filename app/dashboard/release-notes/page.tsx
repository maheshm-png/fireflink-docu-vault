import { redirect } from "next/navigation";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Release notes, newest first (Help > Release notes). For each release, add
// an entry at the top; the newest one is shown open and marked Latest.
type ReleaseNote = {
  release: string;
  date: string;
  summary: string;
  sections: { heading: string; items: { title: string; detail: string }[] }[];
};

const RELEASE_NOTES: ReleaseNote[] = [
  {
    release: "Release 1",
    date: "October 2026",
    summary:
      "The first release of FireFlink Docu Vault: one place to find, review and share the company's documents, for everyone and for each team.",
    sections: [
      {
        heading: "Finding documents",
        items: [
          { title: "Home", detail: "Two tabs: Everyone, with company-wide documents by category, and My teams, with your teams' documents and folders." },
          { title: "Search", detail: "Search by title, tags, category, uploader or any word inside the file. Filter by type, uploader, tags and owner, and save your filters." },
          { title: "Preview", detail: "Open PDFs, presentations, spreadsheets and videos right in the browser, without downloading." },
          { title: "Ask Docu AI", detail: "Ask a question in plain words and get an answer from the documents you can see." },
          { title: "Presales Team Assets", detail: "Quick links to the apps and tools the team uses." },
        ],
      },
      {
        heading: "Uploading and review",
        items: [
          { title: "Upload", detail: "Upload a document for everyone or for your team, pick its category and fill in the category's details." },
          { title: "Review before publishing", detail: "Every upload goes to a reviewer, who approves it or sends it back with comments, including comments on highlighted text." },
          { title: "Versions", detail: "Upload a new version after feedback, see every round of review, and compare any two versions side by side." },
          { title: "Duplicate check", detail: "You're warned when a file or title already exists before uploading it again." },
          { title: "No review needed", detail: "Managers can publish their own upload straight away. It's labelled Review Bypassed so everyone can see it." },
          { title: "My Work", detail: "What's waiting on you, everything you uploaded and everything you reviewed, in one place." },
        ],
      },
      {
        heading: "Teams",
        items: [
          { title: "Team documents", detail: "Documents for a team are seen only by that team, its managers and leadership, and never show up in other teams' search or notifications." },
          { title: "Team roles", detail: "In each team you're a Contributor or a Manager, with the same role in every team you're in. Contributors upload, the team Manager approves. View only is for leadership." },
          { title: "Team folders", detail: "Team Managers create, rename and delete folders and move documents into them." },
          { title: "Request for Everyone", detail: "A team Manager can ask for a team document to be opened to the whole company. The Everyone approver decides." },
          { title: "Leadership view", detail: "Selected people can see every team's documents, or chosen teams only, to view and comment." },
        ],
      },
      {
        heading: "Sharing and control",
        items: [
          { title: "Share with customers", detail: "Create a link to a document for everyone, view only or view and download, with an expiry. Links stop working as soon as sharing is turned off or the document is archived." },
          { title: "Download or preview only", detail: "The approver decides whether people can download a document or only preview it." },
          { title: "Feedback", detail: "Leave comments on a published document when feedback is on, and get replies from its owners." },
          { title: "Categories", detail: "Each category has its own details to fill in. A document can also be listed under more than one category." },
          { title: "Archive and restore", detail: "Archive takes a document out of circulation and tells everyone who could see it. Restoring sends it back for review." },
          { title: "Review reminders", detail: "Documents due for a fresh review are flagged as outdated so they stay current." },
        ],
      },
      {
        heading: "Keeping everyone informed",
        items: [
          { title: "Notifications", detail: "The bell tells you about reviews waiting on you, decisions on your uploads and new documents for you." },
          { title: "Announcements", detail: "Managers post announcements everyone sees on Home." },
          { title: "What can I do?", detail: "Every document page and Help > What can I do? say plainly what you can and can't do with your roles." },
        ],
      },
      {
        heading: "For managers and admins",
        items: [
          { title: "Analytics", detail: "Views, downloads and activity per document, and which documents are outdated." },
          { title: "Audit log", detail: "A record of every upload, decision, download and change." },
          { title: "Deleted documents", detail: "Recover a deleted document if it was removed by mistake." },
          { title: "People", detail: "Add people, set their org role and team roles, and manage teams on one page." },
          { title: "Your account", detail: "Reset your password yourself from the sign-in page or your profile menu." },
        ],
      },
    ],
  },
];

export default async function ReleaseNotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
        <div className="mx-auto w-full max-w-3xl px-6 py-8 animate-fade-in">
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Release notes</h1>
          <p className="mb-6 text-sm text-ff-textMuted">What Docu Vault does, release by release.</p>

          <div className="space-y-4">
            {RELEASE_NOTES.map((note, i) => (
              <details key={note.release} open={i === 0} className="group rounded-ff border border-ff-border bg-white p-5 shadow-ff">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-ff-accent" aria-hidden />
                  <span className="text-base font-bold text-ff-text">{note.release}</span>
                  <span className="text-sm text-ff-textMuted">&middot; {note.date}</span>
                  {i === 0 && (
                    <span className="rounded-full bg-ff-lavender px-2 py-0.5 text-xs font-semibold text-ff-accent">Latest</span>
                  )}
                  <span className="ml-auto text-xs font-medium text-ff-accent group-open:hidden">Show</span>
                  <span className="ml-auto hidden text-xs font-medium text-ff-accent group-open:inline">Hide</span>
                </summary>
                <p className="mt-3 text-sm text-ff-textMuted">{note.summary}</p>
                {note.sections.map((s) => (
                  <div key={s.heading} className="mt-5">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ff-textMuted">{s.heading}</h3>
                    <ul className="space-y-2 text-sm text-ff-text">
                      {s.items.map((item) => (
                        <li key={item.title} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ff-success" aria-hidden />
                          <span>
                            <strong>{item.title}.</strong> {item.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-10 w-full max-w-7xl px-6 text-center text-sm text-ff-textMuted">
          Questions? Email{" "}
          <a href="mailto:docuvault@fireflink.com" className="font-medium text-ff-accent hover:underline">
            docuvault@fireflink.com
          </a>
        </p>
        <Footer />
      </main>
    </div>
  );
}
