"use client";

import { useState } from "react";
import { KeyRound, Copy, Check, X } from "lucide-react";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";
import { generatePassword } from "@/lib/generatePassword";

const MIN_PASSWORD_LENGTH = 8;

// Row-level counterpart to InviteUserForm.tsx's "Set Password Directly"
// mode, for an EXISTING user rather than a brand-new one — the same escape
// hatch (an admin sets a known password directly and hands it to the
// person themselves) but for "this person's invite/forgot-password email
// isn't arriving" or "just give them a fresh password" at any point after
// they've already been added, not just at creation. Calls the same
// PATCH .../users/:id route RoleSelect/DesignationSelect/etc. already use,
// just with a `password` field instead of role/designation/reportsTo.
export default function ResetPasswordButton({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  function close() {
    setOpen(false);
    setPassword("");
    setShowPassword(false);
    setError(null);
    setDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not reset this password, please try again.");
      return;
    }
    setDone(true);
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Reset password"
        aria-label="Reset password"
        className="rounded p-1.5 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-accent"
      >
        <KeyRound className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-ff bg-white shadow-ff-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ff-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ff-text">Reset Password</h2>
                <p className="mt-0.5 text-xs text-ff-textMuted">For {userName}</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-ff-textMuted transition-colors hover:bg-ff-lavender hover:text-ff-text"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="px-5 py-4">
              {done ? (
                <div className="rounded-ff border border-ff-success/30 bg-ff-success/10 p-3">
                  <p className="text-sm font-semibold text-ff-text">Password reset. Copy it and send it to them:</p>
                  <p className="mt-1 break-all text-sm text-ff-textMuted">
                    Password: <span className="font-mono text-ff-text">{password}</span>
                  </p>
                  <button
                    type="button"
                    onClick={copyPassword}
                    className={`mt-2 flex items-center gap-1.5 rounded-ff border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      copied ? "border-ff-success/40 bg-ff-success/10 text-ff-success" : "border-ff-border text-ff-text hover:bg-white"
                    }`}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-ff-textMuted">New Password</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        required
                        type={showPassword ? "text" : "password"}
                        minLength={MIN_PASSWORD_LENGTH}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm outline-none focus:border-ff-accent"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPassword(generatePassword());
                          setShowPassword(true);
                        }}
                        className="shrink-0 rounded-ff border border-ff-border px-2.5 py-2 text-xs font-medium text-ff-text transition-colors hover:bg-ff-lavender/40"
                      >
                        Generate
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="shrink-0 rounded-ff border border-ff-border px-2.5 py-2 text-xs font-medium text-ff-text transition-colors hover:bg-ff-lavender/40"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <AlertModal message={error} onClose={() => setError(null)} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full items-center justify-center rounded-ff bg-ff-accent-gradient py-2 text-sm font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                  >
                    {busy ? <BrandedLoader size={16} variant="white" /> : "Reset Password"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
