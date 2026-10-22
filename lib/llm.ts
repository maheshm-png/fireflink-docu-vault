// Client for the self-hosted LLM server (llama.cpp, OpenAI-compatible
// /v1/chat/completions). Server-side only: the browser never talks to the
// model directly, it always goes through an authenticated API route.
// Set AI_BASE_URL in .env; the address isn't kept in this (public) repo.
const AI_BASE_URL = (process.env.AI_BASE_URL || "http://localhost:8989/v1").replace(/\/+$/, "");
// llama.cpp's own endpoints (/props, /tokenize) live at the server root.
const AI_ROOT_URL = AI_BASE_URL.replace(/\/v1$/, "");
const AI_MODEL = process.env.AI_MODEL || "qwen2.5-vl";
const AI_API_KEY = process.env.AI_API_KEY || "";

export const AI_LIMITS = {
  // Most tokens one request may use (prompt + answer), even if the model
  // allows more: a 3B model answers better from a focused context, and
  // prompt processing time grows with every token sent.
  requestTokens: Number(process.env.AI_REQUEST_TOKENS) || 16_384,
  // Longest answer the model may write.
  maxOutputTokens: Number(process.env.AI_MAX_TOKENS) || 1_536,
  // Generations running at once across the whole app. Matches the
  // server's parallel slots, so requests queue here instead of piling up
  // on the model server.
  maxConcurrent: Number(process.env.AI_MAX_CONCURRENT) || 4,
};

// Used if the server can't tell us its context window.
const FALLBACK_CONTEXT_WINDOW = 8_192;
const CONNECT_TIMEOUT_MS = 30_000; // waiting for the server to accept the request
const IDLE_TIMEOUT_MS = 45_000; // silence mid-answer before giving up
const TOTAL_TIMEOUT_MS = 180_000; // hard cap on one answer
const QUEUE_TIMEOUT_MS = 20_000; // waiting for a free generation slot

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  // "stop" = finished normally, "length" = hit the answer token limit,
  // "aborted" = cancelled (user stopped it, or a timeout).
  finishReason: "stop" | "length" | "aborted";
};

type HttpError = Error & { status: number };

function httpError(message: string, status: number): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  return e;
}

export function aiUnavailableError(): HttpError {
  return httpError("AI assistant is unavailable right now, please try again shortly.", 503);
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(AI_API_KEY ? { Authorization: `Bearer ${AI_API_KEY}` } : {}),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

let contextWindowCache: { value: number; at: number } | null = null;

/**
 * Tokens available to one request: the model's context window as the
 * server reports it, capped by AI_LIMITS.requestTokens. Cached for ten
 * minutes so a normal question costs no extra round trip.
 */
export async function getRequestTokenLimit(): Promise<number> {
  if (contextWindowCache && Date.now() - contextWindowCache.at < 10 * 60_000) {
    return Math.min(contextWindowCache.value, AI_LIMITS.requestTokens);
  }
  let value = 0;
  try {
    const res = await fetchWithTimeout(`${AI_ROOT_URL}/props`, { headers: authHeaders() }, 5_000);
    if (res.ok) {
      const props = await res.json();
      value = Number(props?.default_generation_settings?.n_ctx) || 0;
    }
  } catch {
    // fall through to the fallback below
  }
  if (!value) {
    try {
      const res = await fetchWithTimeout(`${AI_BASE_URL}/models`, { headers: authHeaders() }, 5_000);
      if (res.ok) value = Number((await res.json())?.data?.[0]?.meta?.n_ctx) || 0;
    } catch {
      // fall through
    }
  }
  // Only cache a real answer, so a blip doesn't pin the fallback for ten minutes.
  if (value) contextWindowCache = { value, at: Date.now() };
  return Math.min(value || FALLBACK_CONTEXT_WINDOW, AI_LIMITS.requestTokens);
}

/**
 * Exact token count from the model's own tokenizer. Falls back to a
 * deliberately high estimate (3 characters per token) if the tokenizer
 * can't be reached, so budgets err on the side of fitting.
 */
export async function countTokens(text: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(
      `${AI_ROOT_URL}/tokenize`,
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ content: text }) },
      5_000
    );
    if (res.ok) {
      const tokens = (await res.json())?.tokens;
      if (Array.isArray(tokens)) return tokens.length;
    }
  } catch {
    // fall through to the estimate
  }
  return Math.ceil(text.length / 3);
}

/** Tokens a full message list costs, including the chat template's per-message overhead. */
export async function countMessageTokens(messages: LlmMessage[]): Promise<number> {
  const text = messages.map((m) => `${m.role}\n${m.content}`).join("\n");
  return (await countTokens(text)) + messages.length * 6 + 8;
}

// --- Concurrency gate -------------------------------------------------------
let active = 0;
const waiting: Array<() => void> = [];

function acquireSlot(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      waiting.shift()?.();
    };
    const take = () => {
      active++;
      resolve(release);
    };
    if (active < AI_LIMITS.maxConcurrent) return take();

    const timer = setTimeout(() => {
      const i = waiting.indexOf(onFree);
      if (i >= 0) waiting.splice(i, 1);
      reject(httpError("The AI assistant is busy answering other questions, please try again in a moment.", 503));
    }, QUEUE_TIMEOUT_MS);
    const onFree = () => {
      clearTimeout(timer);
      take();
    };
    waiting.push(onFree);
  });
}

/**
 * One non-streaming completion. Returns null on any failure or timeout, so
 * callers can treat it as optional. `schema` constrains the output to JSON
 * matching it (llama.cpp grammar), which a small model needs to answer in a
 * parseable shape every time.
 */
async function complete(
  messages: LlmMessage[],
  opts: { maxTokens: number; timeoutMs: number; schema?: object; temperature?: number }
): Promise<{ text: string; tokens: number } | null> {
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot();
    const res = await fetchWithTimeout(
      `${AI_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: AI_MODEL,
          messages,
          stream: false,
          temperature: opts.temperature ?? 0,
          max_tokens: Math.min(opts.maxTokens, AI_LIMITS.maxOutputTokens),
          ...(opts.schema ? { response_format: { type: "json_schema", json_schema: { name: "result", schema: opts.schema } } } : {}),
        }),
      },
      opts.timeoutMs
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return { text, tokens: Number(data?.usage?.total_tokens) || Math.ceil(text.length / 3) };
  } catch {
    return null;
  } finally {
    release?.();
  }
}

/**
 * Asks the (vision-capable) model about one image. Plain text answer, or
 * null on any failure. Shares the concurrency gate with chat answers, so
 * background video processing queues behind people waiting for replies
 * rather than crowding them out.
 */
export async function describeImage(
  jpeg: Buffer,
  prompt: string,
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<{ text: string; tokens: number } | null> {
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot();
    const res = await fetchWithTimeout(
      `${AI_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: AI_MODEL,
          stream: false,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 300,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
              ],
            },
          ],
        }),
      },
      opts.timeoutMs ?? 60_000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" ? { text, tokens: Number(data?.usage?.total_tokens) || 0 } : null;
  } catch {
    return null;
  } finally {
    release?.();
  }
}

/** Schema-constrained JSON completion; null if it fails or doesn't parse. */
export async function completeJson(
  messages: LlmMessage[],
  schema: object,
  opts: { maxTokens: number; timeoutMs: number }
): Promise<{ value: unknown; tokens: number } | null> {
  const r = await complete(messages, { ...opts, schema });
  if (!r) return null;
  try {
    return { value: JSON.parse(r.text), tokens: r.tokens };
  } catch {
    return null;
  }
}

/** Plain-text completion; null if it fails. */
export async function completeText(
  messages: LlmMessage[],
  opts: { maxTokens: number; timeoutMs: number }
): Promise<{ text: string; tokens: number } | null> {
  return complete(messages, opts);
}

/**
 * Streams a chat completion as plain UTF-8 text chunks. The server replies
 * with Server-Sent Events ("data: {json}" lines, ending in "data: [DONE]");
 * this unwraps each delta so API routes can pipe the result straight to the
 * browser. onDone fires exactly once, however the stream ends, with the
 * token usage the server reported (or an estimate if it didn't).
 */
export async function streamChat(
  messages: LlmMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onDone?: (usage: LlmUsage) => void;
  } = {}
): Promise<ReadableStream<Uint8Array>> {
  const release = await acquireSlot();
  const upstream = new AbortController();
  const onCallerAbort = () => upstream.abort();
  opts.signal?.addEventListener("abort", onCallerAbort);

  let finished = false;
  let usage: LlmUsage = { promptTokens: 0, completionTokens: 0, finishReason: "aborted" };
  let streamedChars = 0;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
    release();
    if (!usage.completionTokens) usage.completionTokens = Math.ceil(streamedChars / 3);
    try {
      opts.onDone?.(usage);
    } catch (err) {
      console.error("AI usage callback failed:", err);
    }
  };

  const body = JSON.stringify({
    model: AI_MODEL,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: opts.temperature ?? 0.2,
    max_tokens: Math.max(64, Math.min(opts.maxTokens ?? AI_LIMITS.maxOutputTokens, AI_LIMITS.maxOutputTokens)),
    // Small models can fall into repeating the same line; a mild penalty
    // (llama.cpp option) keeps answers moving without hurting accuracy.
    repeat_penalty: 1.1,
  });

  // One retry on a connection failure or 5xx: the server restarting or
  // briefly overloaded shouldn't surface as an error on the first try.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const connectTimer = setTimeout(() => upstream.abort(), CONNECT_TIMEOUT_MS);
    try {
      const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body,
        signal: upstream.signal,
      });
      if (r.ok && r.body) res = r;
      else {
        console.error("AI chat request failed: server responded", r.status, await r.text().catch(() => ""));
        if (r.status < 500) break;
      }
    } catch (err) {
      console.error("AI chat request failed:", err);
      if (upstream.signal.aborted) break;
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res && attempt === 0) await new Promise((r) => setTimeout(r, 750));
  }
  if (!res?.body) {
    finish();
    throw aiUnavailableError();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stop = () => {
    upstream.abort();
    reader.cancel().catch(() => {});
  };
  totalTimer = setTimeout(stop, TOTAL_TIMEOUT_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, IDLE_TIMEOUT_MS);
  };
  resetIdle();

  return new ReadableStream<Uint8Array>({
    async pull(out) {
      // Keep reading until at least one chunk is enqueued (or the stream
      // ends), so a pull that only received role/usage events doesn't
      // resolve empty-handed.
      while (true) {
        let done = false;
        let value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch (err) {
          // Timeout or caller abort mid-answer: end cleanly with what was
          // already sent rather than erroring the whole reply.
          if (streamedChars > 0) out.close();
          else {
            console.error("AI chat stream read failed:", err);
            out.error(aiUnavailableError());
          }
          finish();
          return;
        }

        if (done) {
          if (streamedChars > 0) out.close();
          else out.error(aiUnavailableError());
          finish();
          return;
        }
        resetIdle();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let enqueued = false;
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            if (streamedChars > 0) out.close();
            else out.error(aiUnavailableError());
            reader.cancel().catch(() => {});
            finish();
            return;
          }
          try {
            const event = JSON.parse(data);
            const choice = event?.choices?.[0];
            const text = choice?.delta?.content;
            if (typeof text === "string" && text) {
              streamedChars += text.length;
              enqueued = true;
              out.enqueue(encoder.encode(text));
            }
            if (choice?.finish_reason === "length") usage.finishReason = "length";
            else if (choice?.finish_reason) usage.finishReason = "stop";
            if (event?.usage) {
              usage.promptTokens = Number(event.usage.prompt_tokens) || 0;
              usage.completionTokens = Number(event.usage.completion_tokens) || 0;
            }
          } catch {
            // malformed event, skip rather than aborting the whole answer
          }
        }
        if (enqueued) return;
      }
    },
    cancel() {
      stop();
      finish();
    },
  });
}
