import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";

const MIN_PASSWORD_LENGTH = 8;

// Service-role client — only ever used server-side. Needed because the
// must_change_password flag lives in app_metadata, which a signed-in user
// can't write themselves (unlike user_metadata), so only this route can
// clear it.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/auth/set-password — the signed-in user (an invite-link session,
// or someone an admin gave a temporary password) chooses their own password.
// The password change and the flag being cleared happen in this one call, so
// the flag can't be dropped without a new password actually being set.
export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }

  const {
    data: { user },
  } = await supabaseServer().auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "This link has expired. Ask an admin to send a new invite." }, { status: 401 });
  }

  // Reusing the admin-chosen temporary password would defeat the point.
  // Checked on a throwaway, non-persisting client so it never touches the
  // real session. An invite-link user has no password yet, so this fails
  // for them, which is the expected path.
  if (user.email) {
    const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: same } = await probe.auth.signInWithPassword({ email: user.email, password });
    if (same?.session) {
      return NextResponse.json({ error: "Choose a different password from the temporary one you were given." }, { status: 400 });
    }
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password,
    app_metadata: { must_change_password: false },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
