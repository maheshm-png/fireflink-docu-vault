"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Logo from "@/components/Logo";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Supabase redirects here with a recovery session already established from
// the URL hash (handled automatically by the client library) after the user
// clicks the link from resetPasswordForEmail — this page just collects the
// new password and applies it to that session.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setStatus("idle");
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
        <h1 className="mb-6 text-center text-xl font-bold text-ff-text">Set a New Password</h1>

        {status === "done" ? (
          <p className="rounded-ff border border-ff-success/30 bg-ff-success/10 p-3 text-center text-sm text-ff-success">
            Password updated — redirecting you to sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm text-ff-textMuted">
                New Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm outline-none focus:border-ff-accent"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-sm text-ff-textMuted">
                Confirm Password
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm outline-none focus:border-ff-accent"
              />
            </div>

            <AlertModal message={error} onClose={() => setError(null)} />

            <button
              type="submit"
              disabled={status === "saving"}
              className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105 disabled:opacity-60"
            >
              {status === "saving" ? <BrandedLoader size={18} variant="white" label="Saving..." /> : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
