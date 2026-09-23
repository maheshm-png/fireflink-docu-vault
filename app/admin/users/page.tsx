import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import InviteUserForm from "./InviteUserForm";
import RoleSelect from "./RoleSelect";
import DesignationSelect from "./DesignationSelect";
import TeamSelect from "./TeamSelect";
import ReportsToSelect from "./ReportsToSelect";
import UserActiveToggle from "./UserActiveToggle";
import ResetPasswordButton from "./ResetPasswordButton";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";

// Column widths shared by the header row and every member row below it —
// one place to keep them all lined up. Each of Role/Designation/Team/
// Reports To shows as plain text by default (RoleSelect.tsx etc. only
// reveal their actual <select> once clicked), so these stay narrower than
// they'd need to be if every cell were a permanently-visible dropdown;
// every cell still sets min-w-0 so a cell that IS being edited can't push
// its column wider than its track (a CSS grid item's default
// min-width:auto would otherwise let it).
const GRID_COLS = "150px 220px 110px 170px 120px 130px 64px";

export default async function ManageUsersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/dashboard");

  const [users, designations, teams] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.designation.findMany({ orderBy: { name: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
  ]);
  // Who can be PICKED as someone's reporting manager — every active user,
  // not just role "manager"/"superadmin": some people who functionally
  // manage a team are tagged role "user" or "contributor" for permission
  // reasons (what they're ALLOWED to do in the app) that don't reflect
  // where they sit on the org chart (who reports to them). Restricting this
  // list to the manager/superadmin role would make those real-world
  // reporting lines impossible to represent.
  const reportsToOptions = users.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name }));

  // Reports To is offered for every role (not just contributor/superadmin)
  // — the org chart isn't only reviewers-and-above, everyone except the
  // very top of it has someone they report to. The one carve-out is
  // whoever holds the "Chief Executive Officer" designation: there's
  // nobody above that role for the field to mean anything, so it's hidden
  // entirely for them rather than shown with nothing meaningful to pick.
  const designationNameById = new Map(designations.map((d) => [d.id, d.name]));
  const isCEO = (u: (typeof users)[number]) =>
    u.designationId !== null && designationNameById.get(u.designationId)?.trim().toLowerCase() === "chief executive officer";

  // A removed user is a soft-deactivated one (UserActiveToggle's isActive:
  // false branch) — their row, every document they've ever touched, and
  // their whole history all stay intact, they just can't sign in and
  // shouldn't clutter the list an admin actually manages day to day.
  // Split into its own tab (rather than an inline "Status" column mixed
  // into one table) so that list stays about who's actually active.
  const activeTab = searchParams.status === "removed" ? "removed" : "active";
  const activeUsers = users.filter((u) => u.isActive);
  const removedUsers = users.filter((u) => !u.isActive);
  // Flat list sorted by name — grouping by team or reporting manager both
  // turned out to make the list harder to scan, not easier (people expect
  // to find someone by name, not by hunting through whichever grouping was
  // picked), so this stays one plain, predictably-ordered list. Team and
  // Reports To are still each their own field per row below, just not what
  // organizes the page.
  const visibleUsers = [...(activeTab === "removed" ? removedUsers : activeUsers)].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} userTeam={user.team?.name} userReportsTo={user.reportsTo?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Manage Users</h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          Add teammates and control what they can do in the Docs Hub.
        </p>

        <InviteUserForm />

        <div className="mb-4 mt-8 flex gap-1 rounded-ff border border-ff-border bg-ff-lavender/40 p-0.5 text-xs w-fit">
          <Link
            href="/admin/users"
            className={`rounded-ff px-3 py-1.5 ${activeTab === "active" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
          >
            Active ({activeUsers.length})
          </Link>
          <Link
            href="/admin/users?status=removed"
            className={`rounded-ff px-3 py-1.5 ${activeTab === "removed" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
          >
            Removed ({removedUsers.length})
          </Link>
        </div>

        <div className="overflow-x-auto rounded-ff border border-ff-border bg-white shadow-ff">
          <div
            className="grid min-w-[1050px] gap-3 border-b-2 border-ff-accent/20 bg-ff-lavender px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ff-textMuted"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div>Name</div>
            <div>Email</div>
            <div>Role</div>
            <div>Designation</div>
            <div>Team</div>
            <div>Reports To</div>
            <div>Actions</div>
          </div>

          {visibleUsers.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-ff-textMuted">
              {activeTab === "removed" ? "No removed users." : "No active users."}
            </div>
          )}

          {visibleUsers.map((u) => (
            <div
              key={u.id}
              className="grid min-w-[1050px] items-center gap-3 border-t border-ff-border px-4 py-3"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div className="min-w-0 truncate font-medium text-ff-text">{u.name}</div>
              <div className="min-w-0 truncate text-ff-textMuted">{u.email}</div>
              <div className="min-w-0 text-ff-textMuted">
                <RoleSelect userId={u.id} currentRole={u.role as Role} isSelf={u.id === user.id} />
              </div>
              <div className="min-w-0 text-ff-textMuted">
                <DesignationSelect userId={u.id} currentDesignationId={u.designationId} options={designations} />
              </div>
              <div className="min-w-0 text-ff-textMuted">
                <TeamSelect userId={u.id} currentTeamId={u.teamId} options={teams} />
              </div>
              <div className="min-w-0 text-ff-textMuted">
                {isCEO(u) ? (
                  <span className="text-xs text-ff-textMuted">N/A (CEO)</span>
                ) : (
                  <ReportsToSelect userId={u.id} currentReportsToId={u.reportsToId} options={reportsToOptions} />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <ResetPasswordButton userId={u.id} userName={u.name} />
                <UserActiveToggle userId={u.id} isActive={u.isActive} isSelf={u.id === user.id} />
              </div>
            </div>
          ))}
        </div>
        </div>
      </main>
    </div>
  );
}
