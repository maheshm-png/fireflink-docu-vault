import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { compactConversation, MAX_SUMMARY_CHARS } from "@/lib/aiCompact";
import { recordTokens } from "@/lib/aiUsage";
import type { ChatTurn } from "@/lib/assistant";

// POST /api/assistant/compact: summarizes the older part of a long Ask Docu
// AI conversation. Called by the chat when the user presses Compact, or on
// its own when the conversation grows past what's worth resending.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "viewPublished")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const turns: ChatTurn[] = (Array.isArray(body?.turns) ? body.turns : [])
    .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-40)
    .map((t: any) => ({ role: t.role, content: t.content }));
  const previousSummary = typeof body?.summary === "string" ? body.summary.slice(0, MAX_SUMMARY_CHARS) : "";
  if (!turns.length) return NextResponse.json({ error: "Nothing to compact." }, { status: 400 });

  const result = await compactConversation(turns, previousSummary);
  if (!result) {
    return NextResponse.json({ error: "Couldn't compact the conversation right now, please try again." }, { status: 503 });
  }
  recordTokens(user.id, result.tokens);
  return NextResponse.json({ summary: result.summary });
}
