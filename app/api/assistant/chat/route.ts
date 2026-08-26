import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prepareAssistant, streamOllamaAnswer, type ChatTurn } from "@/lib/assistant";

const MAX_MESSAGE_LENGTH = 2000;

// POST /api/assistant/chat — the "ask the document hub" chat, open to every
// role (same viewPublished audience as the dashboard itself, since it only
// ever answers from published documents). See lib/assistant.ts for the
// retrieval-gating and grounding guardrails.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "viewPublished")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const message: unknown = body?.message;
  const history: unknown = body?.history;

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  const cleanHistory: ChatTurn[] = Array.isArray(history)
    ? history
        .filter(
          (t): t is ChatTurn =>
            t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string"
        )
        .slice(-8)
    : [];

  try {
    const prepared = await prepareAssistant(message.trim(), cleanHistory);
    if (!prepared.matched) {
      return NextResponse.json({ answer: prepared.answer, sources: [] });
    }

    const stream = await streamOllamaAnswer(prepared.prompt);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // Sources are known before generation starts, so they ride along as
        // a header rather than needing a second response shape — the client
        // reads this once up front, then reads the body as a plain token stream.
        "X-Assistant-Sources": encodeURIComponent(JSON.stringify(prepared.sources)),
      },
    });
  } catch (err: any) {
    const status = err?.status ?? 500;
    return NextResponse.json({ error: err?.message ?? "Something went wrong." }, { status });
  }
}
