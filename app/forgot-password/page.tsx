"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import Logo from "@/components/Logo";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

// Self-service password reset, verified by a one-time code emailed to the
// account's address (app/api/auth/forgot-password, app/api/auth/reset-
// password) rather than Supabase Auth's own recovery-link flow, so it
// doesn't depend on the self-hosted Supabase stack's mailer template
// (outside this repo). Two steps in one page rather than two routes,
// there's no separate state to lose between them (no token in a URL to
// click through), just the email carried in memory from step 1 to step 2.
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong, please try again.");
      return;
    }
    setNotice(data.message ?? "If that email belongs to an account, a verification code has been sent.");
    setStep("verify");
  }

  async function handleResend() {
    setLoading(true);
    setError(null);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setNotice("A new code has been sent if needed.");
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setStatus("done");
    setTimeout(() => router.push("/login"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8FA] px-6">
      <div className="w-full max-w-sm rounded-ff border border-ff-border bg-white p-8 shadow-ff">
        <div className="mb-6 flex justify-center">
          <Logo width={140} height={34} priority />
        </div>

        {status === "done" ? (
          <p className="rounded-ff border border-ff-success/30 bg-ff-success/10 p-3 text-center text-sm text-ff-success">
            Password updated, redirecting you to sign in.
          </p>
        ) : step === "request" ? (
          <>
            <h1 className="mb-2 text-center text-xl font-bold text-ff-text">Forgot Password</h1>
            <p className="mb-6 text-center text-sm text-ff-textMuted">
              Enter your account email and we&apos;ll send you a verification code.
            </p>
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm text-ff-textMuted">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm outline-none focus:border-ff-accent"
                />
              </div>

              <AlertModal message={error} onClose={() => setError(null)} />

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-60"
              >
                {loading ? <BrandedLoader size={18} variant="white" label="Sending..." /> : "Send Code"}
              </button>
            </form>
            <p className="mt-6 text-center text-xs text-ff-textMuted">
              <Link href="/login" className="font-bold text-ff-accent hover:text-ff-accentHover">
                Back to Sign In
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-center text-xl font-bold text-ff-text">Verify &amp; Reset</h1>
            {notice && (
              <p className="mb-6 rounded-ff border border-ff-border bg-ff-lavender/40 p-3 text-center text-xs text-ff-textMuted">
                {notice}
              </p>
            )}
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label htmlFor="code" className="mb-1 block text-sm text-ff-textMuted">
                  Verification Code
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-ff border border-ff-border px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-ff-accent"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-ff-textMuted">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-ff border border-ff-border px-3 py-2 pr-10 text-sm outline-none focus:border-ff-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ff-textMuted hover:text-ff-text"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1 block text-sm text-ff-textMuted">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-ff border border-ff-border px-3 py-2 pr-10 text-sm outline-none focus:border-ff-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((s) => !s)}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ff-textMuted hover:text-ff-text"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <AlertModal message={error} onClose={() => setError(null)} />

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-60"
              >
                {loading ? <BrandedLoader size={18} variant="white" label="Saving..." /> : "Reset Password"}
              </button>
            </form>
            <div className="mt-6 flex items-center justify-between text-xs text-ff-textMuted">
              <button
                type="button"
                onClick={() => setStep("request")}
                className="font-bold text-ff-accent hover:text-ff-accentHover"
              >
                Change Email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="font-bold text-ff-accent hover:text-ff-accentHover disabled:opacity-60"
              >
                Resend Code
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-ff-textMuted">
              Didn&apos;t get a code? Contact{" "}
              <a href="mailto:docuvault@fireflink.com" className="font-bold text-ff-accent hover:text-ff-accentHover">
                docuvault@fireflink.com
              </a>{" "}
              for help.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
