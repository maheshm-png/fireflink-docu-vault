import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// POST /api/auth/logout — signs out server-side (clears the auth cookies
// via supabaseServer()'s cookie handlers) so Navbar doesn't need to pull
// the browser Supabase client into every page's bundle just for this button.
export async function POST() {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
