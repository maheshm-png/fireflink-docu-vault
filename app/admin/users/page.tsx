import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import InviteUserForm from "./InviteUserForm";
import RoleSelect from "./RoleSelect";
import DesignationSelect from "./DesignationSelect";
import ReportsToSelect from "./ReportsToSelect";
import UserActiveToggle from "./UserActiveToggle";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";

export default async function ManageUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/dashboard");

  const [users, designations] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.designation.findMany({ orderBy: { name: "asc" } }),
  ]);
  const managers = users
    .filter((u) => u.isActive && (u.role === "manager" || u.role === "superadmin"))
    .map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FBF8FA]">
      <Navbar role={user.role} userName={user.name} userEmail={user.email} userDesignation={user.designation?.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="flex-1 overflow-y-auto mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-ff-text">Manage Users</h1>
        <p className="mb-6 text-sm text-ff-textMuted">
          Add teammates and control what they can do in the Docs Hub.
        </p>

        <InviteUserForm />

        <div className="mt-8 overflow-x-auto rounded-ff border border-ff-border bg-white shadow-ff">
          <table className="w-full text-left text-sm">
            <thead className="border-b-2 border-ff-accent/20 bg-ff-lavender text-xs font-semibold uppercase tracking-wide text-ff-textMuted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium">Reports To</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-ff-border">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-ff-textMuted">{u.email}</td>
                  <td className="px-4 py-3 text-ff-textMuted">
                    <RoleSelect userId={u.id} currentRole={u.role as Role} isSelf={u.id === user.id} />
                  </td>
                  <td className="px-4 py-3 text-ff-textMuted">
                    <DesignationSelect userId={u.id} currentDesignationId={u.designationId} options={designations} />
                  </td>
                  <td className="px-4 py-3 text-ff-textMuted">
                    {u.role === "contributor" || u.role === "superadmin" ? (
                      <ReportsToSelect userId={u.id} currentReportsToId={u.reportsToId} options={managers} />
                    ) : (
                      <span className="text-xs text-ff-textMuted">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <span className="text-ff-success">Active</span>
                    ) : (
                      <span className="text-ff-danger">Removed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <UserActiveToggle userId={u.id} userName={u.name} isActive={u.isActive} isSelf={u.id === user.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </main>
    </div>
  );
}
