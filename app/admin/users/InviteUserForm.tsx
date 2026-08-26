"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlertModal from "@/components/AlertModal";
import InfoTooltip from "@/components/InfoTooltip";

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "user", label: "User" },
];
const ROLE_HELP = "Manager: full access, including delete and approvals. Contributor: upload and view, no delete or approval. User: view only.";

// Kept in sync with lib/emailPolicy.ts server-side default; this is just for
// the inline hint text, the real enforcement happens on the server.
const ALLOWED_DOMAIN_HINT = "@fireflink.com";

export default function InviteUserForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", role: "user" });
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMessage(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErrorMessage(data?.error ?? "Could not invite user — please try again.");
      setStatus("error");
      return;
    }
    setForm({ name: "", email: "", role: "user" });
    setStatus("idle");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-ff border border-ff-border bg-white p-4 shadow-ff">
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
      <div>
        <span className="mb-1 block text-xs text-transparent select-none" aria-hidden>
          &nbsp;
        </span>
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-ff bg-ff-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
        >
          {status === "saving" ? "Inviting..." : "Send Invite"}
        </button>
      </div>
      <AlertModal message={status === "error" ? errorMessage : null} onClose={() => setStatus("idle")} />
    </form>
  );
}
