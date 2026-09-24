"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, X } from "lucide-react";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";
import { ROLE_DESCRIPTIONS } from "@/lib/rbac";
import { generatePassword } from "@/lib/generatePassword";

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "user", label: "User" },
];
// Built from the shared lib/rbac.ts descriptions (not a separate copy) so
// this never drifts out of sync with the real permission matrix the way the
// old hand-written version here did.
const ROLE_HELP = ROLES.map((r) => `${r.label}: ${ROLE_DESCRIPTIONS[r.value as keyof typeof ROLE_DESCRIPTIONS]}`).join(" ");

// Kept in sync with lib/emailPolicy.ts server-side default; this is just for
// the inline hint text, the real enforcement happens on the server.
const ALLOWED_DOMAIN_HINT = "@fireflink.com";

const MIN_PASSWORD_LENGTH = 8;

type Mode = "invite" | "password";

// Two ways to add someone, chosen via the tabs below:
//   - "Send Email Invite" (the original flow): Supabase emails them a
//     magic link and they set their own password from it.
//   - "Set Password Directly": for when that invite email never arrives
//     (Supabase's own SMTP being down/misconfigured, spam filtering,
//     whatever) — the admin sets the password right here, the account is
//     created ready to sign in immediately (see the route's
//     email_confirm: true), and the password is shown once below so it can
//     be handed to the person directly (Slack, in person, phone), no
//     database access needed on either end.
export default function InviteUserForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("invite");
  const [form, setForm] = useState({ name: "", email: "", role: "user", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set right after a successful "Set Password Directly" creation — the
  // only moment this password is ever visible again, since Supabase never
  // hands it back and this app never stores it. Cleared on dismiss or on
  // the next submit.
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setCreatedCredentials(null);
    setForm((f) => ({ ...f, password: "" }));
    setShowPassword(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "password" && form.password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    setCreatedCredentials(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "password" ? form : { name: form.name, email: form.email, role: form.role }
      ),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErrorMessage(data?.error ?? "Could not add this user, please try again.");
      setStatus("error");
      return;
    }
    if (mode === "password") {
      setCreatedCredentials({ email: form.email, password: form.password });
    }
    setForm({ name: "", email: "", role: "user", password: "" });
    setShowPassword(false);
    setStatus("idle");
    router.refresh();
  }

  async function copyCredentials() {
    if (!createdCredentials) return;
    await navigator.clipboard.writeText(`Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <div className="mb-3 flex gap-1 rounded-ff border border-ff-border bg-ff-lavender/40 p-0.5 text-xs w-fit">
        <button
          type="button"
          onClick={() => switchMode("invite")}
          className={`rounded-ff px-2.5 py-1 ${mode === "invite" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
        >
          Send Email Invite
        </button>
        <button
          type="button"
          onClick={() => switchMode("password")}
          className={`rounded-ff px-2.5 py-1 ${mode === "password" ? "bg-white shadow-sm text-ff-text" : "text-ff-textMuted"}`}
        >
          Set Password Directly
        </button>
      </div>

      {mode === "password" && (
        <p className="mb-3 text-xs text-ff-textMuted">
          Use this if the email invite isn&apos;t arriving. The account is ready to sign in immediately with
          whatever password you set below, hand it to them yourself, no database access needed.
        </p>
      )}

      {createdCredentials && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-ff border border-ff-success/30 bg-ff-success/10 p-3">
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ff-text">Account created. Copy these and send them to the user:</p>
            <p className="text-xs text-ff-textMuted">They will be asked to choose their own password the first time they sign in.</p>
            <p className="mt-1 break-all text-ff-textMuted">
              Email: <span className="font-mono text-ff-text">{createdCredentials.email}</span>
            </p>
            <p className="break-all text-ff-textMuted">
              Password: <span className="font-mono text-ff-text">{createdCredentials.password}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={copyCredentials}
              title="Copy email and password"
              className={`flex items-center gap-1.5 rounded-ff border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                copied ? "border-ff-success/40 bg-ff-success/10 text-ff-success" : "border-ff-border text-ff-text hover:bg-white"
              }`}
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setCreatedCredentials(null)}
              aria-label="Dismiss"
              className="rounded p-1 text-ff-textMuted transition-colors hover:bg-white hover:text-ff-text"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ff-textMuted">
            Email <span className="text-ff-textMuted">(must be {ALLOWED_DOMAIN_HINT})</span>
          </label>
          <input
            required
            type="email"
            placeholder={`name${ALLOWED_DOMAIN_HINT}`}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-ff border border-ff-border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs text-ff-textMuted">
            Role
            <InfoTooltip text={ROLE_HELP} />
          </label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="rounded-ff border border-ff-border px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        {mode === "password" && (
          <div>
            <label className="mb-1 block text-xs text-ff-textMuted">Password</label>
            <div className="flex items-center gap-1.5">
              <input
                required
                type={showPassword ? "text" : "password"}
                minLength={MIN_PASSWORD_LENGTH}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="rounded-ff border border-ff-border px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, password: generatePassword() }));
                  setShowPassword(true);
                }}
                className="rounded-ff border border-ff-border px-2.5 py-2 text-xs font-medium text-ff-text transition-colors hover:bg-ff-lavender/40"
              >
                Generate
              </button>
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="rounded-ff border border-ff-border px-2.5 py-2 text-xs font-medium text-ff-text transition-colors hover:bg-ff-lavender/40"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        )}
        <div>
          <span className="mb-1 block text-xs text-transparent select-none" aria-hidden>
            &nbsp;
          </span>
          <button
            type="submit"
            disabled={status === "saving"}
            className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
          >
            {status === "saving" ? "Adding..." : mode === "password" ? "Create Account" : "Send Invite"}
          </button>
        </div>
        <AlertModal message={status === "error" ? errorMessage : null} onClose={() => setStatus("idle")} />
      </form>
    </div>
  );
}
