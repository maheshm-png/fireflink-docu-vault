"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, X } from "lucide-react";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";
import { LeadershipViewPicker, leadershipBody, type LeadershipValue } from "./LeadershipView";
import { generatePassword } from "@/lib/generatePassword";
import { ORG_LEVEL, ORG_ROLE_OPTIONS, TEAM_ROLE_OPTIONS, type TeamRoleValue } from "@/lib/roleCopy";

// Kept in sync with lib/emailPolicy.ts server-side default; this is just for
// the inline hint text, the real enforcement happens on the server.
const ALLOWED_DOMAIN_HINT = "@fireflink.com";
const MIN_PASSWORD_LENGTH = 8;

// Add a person in one short form: who they are, their org role (documents
// for everyone) and, optionally, their teams with a role in each. The
// password is optional: left empty, they get an email invite and pick their
// own; filled in, the account is ready right away and the password is shown
// once to hand over (they choose their own at first sign-in).
export default function InviteUserForm({ teams = [] }: { teams?: { id: string; name: string }[] }) {
  const router = useRouter();
  // No role is pre-picked: the admin chooses the org role, and the team role
  // when a team is picked, every time.
  const [form, setForm] = useState({ name: "", email: "", role: "", password: "" });
  // One team at invite time (more can be added later from the Team roles
  // column): Team and Team role as two plain dropdowns.
  const [teamId, setTeamId] = useState("");
  const [teamRole, setTeamRole] = useState<TeamRoleValue | "">("");
  const [leadership, setLeadership] = useState<LeadershipValue>({ mode: "off", teamIds: [] });
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Shown once after creating an account with a password: Supabase never
  // hands it back and this app never stores it.
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const orgRole = ORG_ROLE_OPTIONS.find((r) => r.value === form.role);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.role || (teamId && !teamRole)) {
      setErrorMessage(!form.role ? "Pick an org role for this person." : "Pick their role in the team, or choose No team.");
      setStatus("error");
      return;
    }
    if (form.password && form.password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters, or leave it empty to send an invite.`);
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    setCreated(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        role: form.role,
        ...(form.password ? { password: form.password } : {}),
        teams: teamId ? [{ teamId, role: teamRole }] : [],
        ...leadershipBody(leadership),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErrorMessage(data?.error ?? "Could not add this person, please try again.");
      setStatus("error");
      return;
    }
    setCreated({ email: form.email, password: form.password || null });
    setForm({ name: "", email: "", role: "", password: "" });
    setTeamId("");
    setTeamRole("");
    setLeadership({ mode: "off", teamIds: [] });
    setStatus("idle");
    router.refresh();
  }

  async function copyCredentials() {
    if (!created?.password) return;
    await navigator.clipboard.writeText(`Email: ${created.email}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const label = "mb-1 block text-sm font-medium text-ff-text";
  const input = "w-full rounded-ff border border-ff-border px-3 py-2 text-sm";

  return (
    <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-3 text-base font-bold text-ff-text">Add a person</h2>

      {created && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-ff border border-ff-success/30 bg-ff-success/10 p-3 text-sm">
          <div className="min-w-0">
            {created.password ? (
              <>
                <p className="font-semibold text-ff-text">Account ready. Send these to them:</p>
                <p className="break-all text-ff-textMuted">
                  Email: <span className="font-mono text-ff-text">{created.email}</span>
                  <br />
                  Password: <span className="font-mono text-ff-text">{created.password}</span>
                </p>
                <p className="text-xs text-ff-textMuted">They&apos;ll choose their own password the first time they sign in.</p>
              </>
            ) : (
              <p className="font-semibold text-ff-text">Invite sent to {created.email}.</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {created.password && (
              <button
                type="button"
                onClick={copyCredentials}
                className={`flex items-center gap-1.5 rounded-ff border px-2.5 py-1.5 text-xs font-medium ${
                  copied ? "border-ff-success/40 text-ff-success" : "border-ff-border text-ff-text hover:bg-white"
                }`}
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            <button type="button" onClick={() => setCreated(null)} aria-label="Dismiss" className="rounded p-1 text-ff-textMuted hover:text-ff-text">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className={label}>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
            </div>
            <div>
              <label className={label}>Email</label>
              <input
                required
                type="email"
                placeholder={`name${ALLOWED_DOMAIN_HINT}`}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={`${label} flex items-center gap-1`}>
                Password <span className="font-normal text-ff-textMuted">(optional)</span>
                <InfoTooltip text="Leave empty to email them an invite. Set one to let them sign in right away." />
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={input}
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
                  className="shrink-0 rounded-ff border border-ff-border px-3 text-xs font-medium text-ff-text hover:bg-ff-lavender/40"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className={`${label} flex items-center gap-1`}>
                {ORG_LEVEL.title}
                <InfoTooltip text={`${ORG_LEVEL.covers}.${orgRole ? ` ${orgRole.label}: ${orgRole.short}` : ""}`} />
              </label>
              <select required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
                <option value="" disabled>
                  Pick an org role
                </option>
                {ORG_ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>
                  Team <span className="font-normal text-ff-textMuted">(optional)</span>
                </label>
                <select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    if (!e.target.value) setTeamRole("");
                  }}
                  className={input}
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`${label} flex items-center gap-1`}>
                  Team role
                  <InfoTooltip
                    text={`${TEAM_ROLE_OPTIONS.map((r) => `${r.label}: ${r.short}`).join(" ")} Add more teams later from the Team roles column.`}
                    align="right"
                  />
                </label>
                <select
                  value={teamRole}
                  disabled={!teamId}
                  required={Boolean(teamId)}
                  onChange={(e) => setTeamRole(e.target.value as TeamRoleValue)}
                  className={`${input} disabled:bg-ff-lavender/40 disabled:text-ff-textMuted`}
                >
                  <option value="" disabled>
                    {teamId ? "Pick a role" : "-"}
                  </option>
                  {TEAM_ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-sm font-medium text-ff-text">
                Leadership view <span className="font-normal text-ff-textMuted">(optional)</span>
                <InfoTooltip text="View, download and comment on these teams' documents without being in them. Nothing more." />
              </label>
              <LeadershipViewPicker teams={teams} value={leadership} onChange={setLeadership} />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={status === "saving"}
          className="mt-4 rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff hover:brightness-105 disabled:opacity-60"
        >
          {status === "saving" ? "Adding..." : form.password ? "Create account" : "Send invite"}
        </button>
        <AlertModal message={status === "error" ? errorMessage : null} onClose={() => setStatus("idle")} />
      </form>
    </div>
  );
}
