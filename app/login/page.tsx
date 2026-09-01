"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import Logo from "@/components/Logo";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);

  // Brief branded intro on first landing on the login screen — logo animates
  // in, holds, then fades to reveal the sign-in form underneath (which is
  // already mounted the whole time, so there's no layout shift on handoff).
  const [introPhase, setIntroPhase] = useState<"in" | "out" | "done">("in");
  useEffect(() => {
    const t1 = setTimeout(() => setIntroPhase("out"), 900);
    const t2 = setTimeout(() => setIntroPhase("done"), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Email or password is incorrect.");
      return;
    }
    router.push("/dashboard/home");
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setResetStatus("sending");
    setResetErrorMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setResetErrorMessage(error.message);
      setResetStatus("error");
      return;
    }
    setResetStatus("sent");
  }

  return (
    <div className="flex min-h-screen">
      {/* Left: brand panel */}
      <div className="relative hidden w-[55%] flex-col justify-between overflow-hidden bg-ff-plum-gradient px-14 py-12 text-white lg:flex">
        <DecorativePattern />

        <div className="relative z-10">
          <Logo variant="white" width={160} height={38} priority />
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="mb-4 text-3xl font-bold leading-tight">
            Simplify Access. Amplify Control.
          </h1>
          <p className="mb-6 text-white/70">
            Your secure home for sales and demo collateral. Organized, versioned, and always up to date.
          </p>
          <p className="text-lg font-semibold text-white/90">Get. Set. FireFlink!</p>
        </div>

        <div className="relative z-10">
          <p className="text-xs text-white/50">Copyright © FireFlink Pvt Ltd. All Rights Reserved</p>
          <p className="mt-1 text-xs text-white/40">Contributed by Presales Demo Team</p>
        </div>
      </div>

      {/* Right: sign-in form */}
      <div className="flex flex-1 items-center justify-center bg-ff-surface-gradient px-6 py-12">
        <div className="w-full max-w-sm rounded-ff border border-ff-border bg-white p-8 shadow-ff-lg">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo width={140} height={34} priority />
          </div>

          {!forgotMode ? (
            <>
              <h2 className="mb-6 text-center text-2xl font-bold text-ff-text">Sign In</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm text-ff-textMuted">
                    Email <span className="text-ff-danger">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-ff border border-ff-border bg-ff-lavender/60 px-3 py-2.5 text-sm outline-none transition-colors focus:border-ff-accent focus:bg-white focus:shadow-ff-glow"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1 block text-sm text-ff-textMuted">
                    Password <span className="text-ff-danger">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-ff border border-ff-border bg-ff-lavender/60 px-3 py-2.5 pr-10 text-sm outline-none transition-colors focus:border-ff-accent focus:bg-white focus:shadow-ff-glow"
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
                  <div className="mt-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => setForgotMode(true)}
                      className="text-xs text-ff-accent hover:underline"
                    >
                      Forgot Password ?
                    </button>
                  </div>
                </div>

                <AlertModal message={error} onClose={() => setError(null)} />

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-60"
                >
                  {loading ? <BrandedLoader size={18} variant="white" label="Signing in..." /> : "Sign In"}
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-ff-textMuted">
                Accounts are created by your FireFlink Docu Vault admin. Contact your superadmin for
                access.
              </p>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-center text-2xl font-bold text-ff-text">Reset Password</h2>
              <p className="mb-6 text-center text-sm text-ff-textMuted">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              {resetStatus === "sent" ? (
                <p className="rounded-ff border border-ff-success/30 bg-ff-success/10 p-3 text-center text-sm text-ff-success">
                  Check your inbox for a reset link.
                </p>
              ) : (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div>
                    <label htmlFor="resetEmail" className="mb-1 block text-sm text-ff-textMuted">
                      Email
                    </label>
                    <input
                      id="resetEmail"
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="w-full rounded-ff border border-ff-border bg-ff-lavender/60 px-3 py-2.5 text-sm outline-none transition-colors focus:border-ff-accent focus:bg-white focus:shadow-ff-glow"
                    />
                  </div>
                  <AlertModal
                    message={resetStatus === "error" ? resetErrorMessage ?? "Could not send reset link. Please try again." : null}
                    onClose={() => setResetStatus("idle")}
                  />
                  <button
                    type="submit"
                    disabled={resetStatus === "sending"}
                    className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-60"
                  >
                    {resetStatus === "sending" ? (
                      <BrandedLoader size={18} variant="white" label="Sending..." />
                    ) : (
                      "Send Reset Link"
                    )}
                  </button>
                </form>
              )}
              <button
                type="button"
                onClick={() => {
                  setForgotMode(false);
                  setResetStatus("idle");
                }}
                className="mt-4 w-full text-center text-xs text-ff-accent hover:underline"
              >
                Back to Sign In
              </button>
            </>
          )}
        </div>
      </div>

      {introPhase !== "done" && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-white ${
            introPhase === "out" ? "animate-intro-fade-out" : ""
          }`}
          aria-hidden
        >
          <div className="flex items-center">
            <div className="animate-intro-logo-in">
              <Logo variant="color" width={220} height={54} priority />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Subtle circuit/dot texture for the brand panel — CSS-only, no external image asset. */
function DecorativePattern() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1.5px 1.5px, rgba(255,255,255,0.25) 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-ff-accent/30 blur-3xl" />
      <div className="absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-ff-accentHover/20 blur-3xl" />
    </div>
  );
}
