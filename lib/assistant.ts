import { searchScored } from "./search";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

const MAX_SOURCE_DOCS = 6;
const MAX_EXCERPT_CHARS = 900;
const MAX_HISTORY_TURNS = 4;

export type ChatSource = {
  id: string;
  title: string;
  categoryName: string;
  docType: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

// What POST /api/assistant/chat gets back from prepareAssistant: either the
// fixed no-match answer (no model call needed), or a grounded prompt ready
// to stream through Ollama plus the sources to attach to the eventual reply.
export type PreparedAssistant =
  | { matched: false; answer: string }
  | { matched: true; sources: ChatSource[]; prompt: string };

const NO_MATCH_ANSWER = "No relevant content found.";

function unavailableError(): Error & { status: number } {
  const e = new Error("AI assistant is unavailable right now — please try again shortly.") as Error & {
    status: number;
  };
  e.status = 503;
  return e;
}

// Meilisearch's default matching strategy drops words from the END of the
// query when the full phrase has no match — great for keyword search boxes,
// bad for natural-language questions, where the filler words ("tell me
// about", "what is", "do we have") sit at the front and the actual topic
// sits at the back. Left as-is, "Tell me about our case studies" degrades
// to "Tell me about our" before it ever tries "case studies" alone. Instead
// of relying on Meilisearch to guess, strip the filler ourselves so the
// query it receives is just the topic.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "can", "could", "would", "should", "will", "shall",
  "tell", "me", "my", "our", "your", "us", "i", "we", "you", "please",
  "find", "show", "give", "get", "need", "want", "looking", "have", "has",
  "had", "any", "some", "about", "for", "of", "to", "in", "on", "at",
  "with", "and", "or", "what", "which", "who", "whom", "how", "when",
  "where", "why", "this", "that", "these", "those", "there",
]);

function extractSearchQuery(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const keywords = words.filter((w) => !STOPWORDS.has(w));
  // If stripping stopwords leaves nothing (e.g. the question was itself
  // all filler), fall back to the original question rather than searching
  // on an empty string.
  return keywords.length ? keywords.join(" ") : question;
}

/**
 * Retrieval-gated Q&A over the published document set: Meilisearch finds
 * candidate docs first, and the model only ever sees those excerpts (never
 * the open internet or its own training knowledge). If retrieval comes back
 * empty, we skip the model call entirely and return the fixed no-match
 * answer — the strongest guardrail against hallucination is not giving the
 * model an opening to invent something in the first place. When there are
 * hits, the system prompt further restricts it to only what's in CONTEXT,
 * and the caller always renders the source list alongside the answer so the
 * user can verify it against the real documents.
 */
export async function prepareAssistant(question: string, history: ChatTurn[] = []): Promise<PreparedAssistant> {
  const searchQuery = extractSearchQuery(question);
  const results = await searchScored(searchQuery, ['status = "published"'], MAX_SOURCE_DOCS);
  const hits = results.hits as unknown as Array<{
    id: string;
    title: string;
    categoryName: string;
    docType: string;
    tags: string[];
    extractedText?: string;
  }>;

  if (hits.length === 0) {
    return { matched: false, answer: NO_MATCH_ANSWER };
  }

  const sources: ChatSource[] = hits.map((h) => ({
    id: h.id,
    title: h.title,
    categoryName: h.categoryName,
    docType: h.docType,
  }));

  const context = hits
    .map((h, i) => {
      const excerpt = (h.extractedText ?? "").slice(0, MAX_EXCERPT_CHARS).trim();
      return [
        `[Document ${i + 1}] "${h.title}"`,
        `Category: ${h.categoryName} | Type: ${h.docType}${h.tags?.length ? ` | Tags: ${h.tags.join(", ")}` : ""}`,
        excerpt ? `Excerpt: ${excerpt}` : "Excerpt: (no extracted text available for this document)",
      ].join("\n");
    })
    .join("\n\n");

  const recentHistory = history.slice(-MAX_HISTORY_TURNS);
  const historyBlock = recentHistory.length
    ? recentHistory.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n") + "\n"
    : "";

  const prompt = `You are the FireFlink Docu Vault assistant. You help users find and understand sales/demo documents that live in this document hub.

Rules (follow strictly):
- Answer ONLY using the CONTEXT DOCUMENTS below. Never use outside knowledge, and never invent facts, filenames, or details that aren't in the context.
- If the context documents don't actually contain enough information to answer the question, say plainly that you couldn't find enough information in the available documents — do not guess.
- When you use a document, refer to it by its exact title so the user knows which one you mean.
- Don't just copy fragments from the excerpts — explain the answer in your own words, in full sentences, the way you'd walk a colleague through what the document actually says. It's fine to be thorough when the context supports it; don't pad with filler, but don't clip a real explanation short either.
- Plain text only, no markdown formatting.

CONTEXT DOCUMENTS:
${context}

${historyBlock}User: ${question}

Assistant:`;

  return { matched: true, sources, prompt };
}

/**
 * Streams the model's answer as raw text chunks. Ollama's /api/generate
 * with stream:true emits newline-delimited JSON objects; this reframes that
 * into a plain UTF-8 text stream the API route can hand straight to the
 * client, so the browser can render tokens as they arrive instead of
 * blocking on the full ~30-90s CPU generation time.
 */
export async function streamOllamaAnswer(prompt: string): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: true }),
    });
  } catch (err) {
    console.error("Assistant chat generation failed:", err);
    throw unavailableError();
  }
  if (!res.ok || !res.body) {
    console.error("Assistant chat generation failed: Ollama responded", res.status);
    throw unavailableError();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sawAnyText = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let done = false;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        console.error("Assistant chat stream read failed:", err);
        controller.error(sawAnyText ? err : unavailableError());
        return;
      }

      if (done) {
        if (!sawAnyText) controller.error(unavailableError());
        else controller.close();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.response === "string" && obj.response) {
            sawAnyText = true;
            controller.enqueue(encoder.encode(obj.response));
          }
          if (obj.done) {
            controller.close();
            return;
          }
        } catch {
          // malformed NDJSON line — skip rather than aborting the whole stream
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
