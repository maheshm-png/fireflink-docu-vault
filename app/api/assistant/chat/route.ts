import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { can } from "@/lib/rbac";
import { prepareAssistant, type ChatTurn } from "@/lib/assistant";
import { streamChat } from "@/lib/llm";
import { checkQuestion, guardAnswerStream, OUT_OF_SCOPE } from "@/lib/aiGuard";
import { composeReply, type ReplyKind } from "@/lib/aiReplies";
import { planQuestion } from "@/lib/aiPlanner";
import { suggestionsFor } from "@/lib/aiSuggestions";
import { MAX_SUMMARY_CHARS } from "@/lib/aiCompact";
import { recordTokens, startQuestion } from "@/lib/aiUsage";

const MAX_MESSAGE_LENGTH = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/assistant/chat: the Ask Docu AI chat, open to every role that
// can see published documents. Answers come only from documents the user
// may see (lib/assistant.ts), screened on the way in and out (lib/aiGuard.ts)
// and limited per user (lib/aiUsage.ts).
//
// Response: JSON { answer, sources, scope? } for fixed answers, or a text
// stream for model answers, with sources/scope in headers up front and an
// AnswerMeta record after a \u001e separator at the end.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "viewPublished")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const message: unknown = body?.message;

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "That message is too long. Please keep it under 2000 characters." }, { status: 400 });
  }

  const question = message.trim();
  const verdict = checkQuestion(question);

  // History comes from the browser, so it's treated as untrusted: only
  // well-formed turns, and any exchange whose question fails the screen is
  // dropped along with its answer.
  const rawHistory: unknown[] = Array.isArray(body?.history) ? body.history.slice(-12) : [];
  const history: ChatTurn[] = [];
  for (let i = 0; i < rawHistory.length; i++) {
    const t = rawHistory[i] as ChatTurn;
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") continue;
    if (t.role === "user" && !checkQuestion(t.content).ok) {
      if ((rawHistory[i + 1] as ChatTurn)?.role === "assistant") i++;
      continue;
    }
    history.push({ role: t.role, content: t.content });
  }

  const previousSourceIds: string[] = Array.isArray(body?.previousSourceIds)
    ? body.previousSourceIds.filter((id: unknown) => typeof id === "string" && UUID.test(id)).slice(0, 10)
    : [];

  // The compacted earlier part of the conversation (lib/aiCompact.ts), sent
  // back by the browser. Context only, and screened like history.
  const summary =
    typeof body?.summary === "string" && checkQuestion(body.summary).ok ? body.summary.slice(0, MAX_SUMMARY_CHARS) : "";

  const allowance = startQuestion(user.id);
  if (!allowance.ok) return NextResponse.json({ error: allowance.error }, { status: allowance.status });

  // Replies that aren't document answers are still written by the model
  // (lib/aiReplies.ts); `fallback` is only used if it can't be reached.
  const reply = async (kind: ReplyKind, fallback: string, extra: Record<string, unknown> = {}, withSuggestions = true) => {
    const [written, suggestions] = await Promise.all([
      composeReply(user, kind, question, fallback),
      withSuggestions ? suggestionsFor(user) : Promise.resolve([] as string[]),
    ]);
    recordTokens(user.id, written.tokens);
    allowance.release();
    return NextResponse.json({ answer: written.text, sources: [], ...extra, ...(suggestions.length ? { suggestions } : {}) });
  };

  try {
    // Declined by the screen (lib/aiGuard.ts): the model only learns why,
    // never sees the message itself.
    if (!verdict.ok) {
      return await reply({ kind: "declined", reason: verdict.reason }, verdict.answer, {}, verdict.reason !== "self_harm");
    }

    // The model's reading of the message: small talk, or what to search for.
    const planned = await planQuestion(question, history);
    if (planned) recordTokens(user.id, planned.tokens);
    const plan = planned?.plan ?? null;

    // Trusted only for short messages, so a real question the planner
    // misreads as small talk still gets searched.
    const isShort = question.split(/\s+/).length <= 8;
    const aboutCompany = /\b(we|our|us|ours|company|firm)\b/i.test(question);
    const addressesAssistant = /\b(you|your|yourself|docu ai|assistant|bot)\b/i.test(question);
    const smallTalk =
      plan &&
      isShort &&
      !aboutCompany &&
      (plan.intent === "greeting" || (plan.intent === "about_assistant" && addressesAssistant));
    if (plan && smallTalk) {
      return await reply(
        { kind: plan.intent === "greeting" ? "greeting" : "about_assistant" },
        "Hi! I'm Docu AI. Ask me about any document you can access in Docu Vault and I'll answer from it, with links to the source."
      );
    }

    const prepared = await prepareAssistant(user, question, history, previousSourceIds, { plan, summary });
    if (!prepared.matched) {
      if (prepared.tokens) recordTokens(user.id, prepared.tokens);
      // A finished document list goes out as is.
      if (prepared.reason === "listed") {
        allowance.release();
        return NextResponse.json({ answer: prepared.answer, sources: prepared.sources ?? [], scope: prepared.scope });
      }
      const offTopic = plan?.intent === "off_topic" && !prepared.sources?.length;
      const kind: ReplyKind = offTopic
        ? { kind: "declined", reason: "off_topic" }
        : prepared.reason === "unreadable"
          ? { kind: "unreadable", titles: (prepared.sources ?? []).map((s) => s.title) }
          : { kind: prepared.reason };
      return await reply(
        kind,
        offTopic ? OUT_OF_SCOPE : prepared.answer,
        { sources: prepared.sources ?? [], scope: prepared.scope },
        !prepared.sources?.length
      );
    }

    let truncated = false;
    const raw = await streamChat(prepared.messages, {
      temperature: 0,
      maxTokens: prepared.maxTokens,
      // Stops generating (and frees the model) when the user leaves or
      // presses Stop, instead of finishing an answer nobody will read.
      signal: req.signal,
      onDone: (usage) => {
        truncated = usage.finishReason === "length";
        recordTokens(user.id, (usage.promptTokens || prepared.promptTokens) + usage.completionTokens + (prepared.tokens ?? 0));
        allowance.release();
      },
    });

    const stream = guardAnswerStream(raw, {
      sources: prepared.sources,
      wasTruncated: () => truncated,
      onBlocked: () => console.warn(`Assistant answer blocked by output filter (user ${user.id})`),
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        // Keeps reverse proxies from buffering the stream into one chunk.
        "X-Accel-Buffering": "no",
        "X-Assistant-Sources": encodeURIComponent(JSON.stringify(prepared.sources)),
        ...(prepared.scope ? { "X-Assistant-Scope": encodeURIComponent(JSON.stringify(prepared.scope)) } : {}),
      },
    });
  } catch (err: any) {
    allowance.release();
    const status = err?.status ?? 500;
    if (status >= 500) console.error("Assistant chat failed:", err);
    return NextResponse.json(
      { error: status >= 500 && !err?.status ? "Something went wrong, please try again." : err?.message ?? "Something went wrong." },
      { status }
    );
  }
}
