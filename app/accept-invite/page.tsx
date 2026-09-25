"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Logo from "@/components/Logo";
import BrandedLoader from "@/components/BrandedLoader";
import AlertModal from "@/components/AlertModal";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Supabase redirects here with an invite session already established from
// the URL hash (handled automatically by the client library) after the
// user clicks the action_link emailed by app/api/admin/users's POST handler
// (generated via generateLink, sent through this app's own SMTP rather than
// Supabase's — see that route's own comment for why). Also where middleware.ts
// sends anyone signed in with a must_change_password flag, which includes
// users an admin gave a password to directly: they sign in normally, then
// land here to replace it with their own.
const EXPIRED_MESSAGE = "This invite link has expired or was already used. Ask an admin to send a new invite.";

export default function AcceptInvitePage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  // Whether this visit actually has a session to set a password on. The form
  // is only shown for "valid": an expired/used link used to show an error
  // popup and then, once dismissed, the same password form anyway, which
  // could never work.
  const [linkState, setLinkState] = useState<"checking" | "valid" | "invalid">("checking");

  // Turns an invite link into a session. The emailed link carries a one-time
  // token_hash in the query (see app/api/admin/users), exchanged here via
  // verifyOtp. The URL-hash branch below covers links Supabase built itself
  // (implicit flow), which this PKCE browser client would otherwise ignore.
  // With neither, an existing session (someone already signed in and sent
  // here by middleware.ts) counts as valid; no session at all means there is
  // nothing to set a password on.
  useEffect(() => {
    const done = (ok: boolean) => {
      // Tokens shouldn't linger in the address bar or browser history.
      window.history.replaceState(null, "", window.location.pathname);
      setLinkState(ok ? "valid" : "invalid");
    };
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash");
    if (tokenHash) {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" }).then(({ error }) => done(!error));
      return;
    }
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("error") || params.get("error_description")) {
      done(false);
      return;
    }
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => done(!error));
      return;
    }
    supabase.auth.getSession().then(({ data }) => setLinkState(data.session ? "valid" : "invalid"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("saving");
    // Read before saving: changing the password revokes this session.
    const { data: { session } } = await supabase.auth.getSession();
    // Saved server-side, not via supabase.auth.updateUser: that route is the
    // only thing that can clear the must_change_password flag middleware.ts
    // enforces, and it does so in the same call that changes the password.
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not set your password, please try again.");
      setStatus("idle");
      return;
    }
    // Changing a password revokes the old session's refresh token, and its
    // JWT still carries the old flag, so sign in again with the new password
    // to get a clean session. If that somehow fails, plain sign-in still works.
    const email = session?.user.email;
    const relogin = email ? await supabase.auth.signInWithPassword({ email, password }) : null;
    setStatus("done");
    // Full page load, not router.push: this page was usually reached by a
    // client-side redirect from middleware, and the router doesn't reliably
    // leave it again for the same target it was just bounced away from.
    setTimeout(() => window.location.assign(relogin && !relogin.error ? "/dashboard/home" : "/login"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8FA] px-6">
      <div className="w-full max-w-sm rounded-ff border border-ff-border bg-white p-8 shadow-ff">
        <div className="mb-6 flex justify-center">
          <Logo width={140} height={34} priority />
        </div>
        <h1 className="mb-2 text-center text-xl font-bold text-ff-text">Welcome to Docu Vault</h1>
        <p className="mb-6 text-center text-sm text-ff-textMuted">Set a password to finish setting up your account.</p>

        {linkState === "checking" ? (
          <div className="flex justify-center py-6">
            <BrandedLoader size={28} label="Checking your invite..." />
          </div>
        ) : linkState === "invalid" ? (
          <div className="space-y-4">
            <p className="rounded-ff border border-ff-danger/30 bg-ff-danger/10 p-3 text-center text-sm text-ff-danger">
              {EXPIRED_MESSAGE}
            </p>
            <button
              type="button"
              onClick={() => window.location.assign("/login")}
              className="flex w-full items-center justify-center rounded-full bg-ff-accent-gradient py-2.5 text-sm font-medium text-white shadow-ff-md transition-all hover:shadow-ff-lg hover:brightness-105"
            >
              Go to Sign In
            </button>
          </div>
        ) : status === "done" ? (
          <p className="rounded-ff border border-ff-success/30 bg-ff-success/10 p-3 text-center text-sm text-ff-success">
            Password set, taking you to your dashboard.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm text-ff-textMuted">
                Password
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
              {status === "saving" ? <BrandedLoader size={18} variant="white" label="Saving..." /> : "Set Password & Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
