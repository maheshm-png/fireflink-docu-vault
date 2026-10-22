import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { suggestionsFor } from "@/lib/aiSuggestions";

// GET /api/assistant/session: what the Ask Docu AI chat needs on open: whose
// saved conversations to load (they're kept in this browser, per user) and
// starter questions built from documents this user can see.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "viewPublished")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(
    { userId: user.id, suggestions: await suggestionsFor(user) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
