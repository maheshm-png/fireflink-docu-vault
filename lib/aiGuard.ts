// Guardrails for Ask Docu AI, applied on both sides of the model:
// checkQuestion() screens what the user asks before any search or model
// call, and guardAnswerStream() filters what the model writes before it
// reaches the browser. Deterministic on purpose: a 3B model can't be
// trusted to police itself, so the hard limits live in code.

// Why a question was declined. The reply itself is written by the model
// (lib/aiReplies.ts) from this reason alone; `answer` is only the fallback
// for when the model can't be reached.
export type DeclineReason = "self_harm" | "injection" | "harmful" | "off_topic";
export type GuardResult = { ok: true } | { ok: false; reason: DeclineReason; answer: string };

export const OUT_OF_SCOPE =
  "I can only help with questions about the documents in Docu Vault. Try asking about a document, product, client or topic.";

// Attempts to override the assistant's rules or extract its instructions.
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|your|the|these)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines?|directions?)\b/i,
  /\b(system|hidden|initial|original)\s+(prompt|instructions?|message)\b/i,
  /\b(reveal|show|print|repeat|output)\b.{0,30}\b(your|the)\s+(prompt|instructions?|rules)\b/i,
  /\b(you are now|from now on you|pretend (to be|you are)|roleplay as|jailbreak|developer mode|do anything now)\b/i,
  /\bDAN\b/,
];

const SELF_HARM = /\b(kill(ing)? myself|suicid(e|al)|self[- ]?harm|end(ing)? my life|want to die|hurt(ing)? myself)\b/i;

// Requests for clearly harmful or inappropriate content. The assistant only
// ever answers from company documents, so none of these have a legitimate
// use here; refusing outright is safer than hoping the model declines.
const DISALLOWED = [
  // sexual content
  /\b(porn\w*|nude|nudes|naked|sex(ual|y)?\s+(story|stories|content|chat|act|position)|erotic\w*|nsfw|fetish\w*|hentai|onlyfans)\b/i,
  // violence, weapons, crime
  /\b(how (do i|to|can i)|ways to|help me)\b.{0,40}\b(kill|murder|poison|stab|shoot|bomb|attack|kidnap|torture)\b/i,
  /\b(make|build|create|assemble)\b.{0,25}\b(bomb|explosive|weapon|gun|meth|drugs?|poison)\b/i,
  /\b(hack(ing)? into|steal(ing)?|phish(ing)?|crack(ing)?)\b.{0,30}\b(account|password|credentials?|bank|email|system)s?\b/i,
  /\b(malware|ransomware|keylogger|ddos)\b/i,
  // deceiving, exploiting or targeting a person
  /\b(how (do i|to|can i|should i|would i)|help me|ways? to|tips? (to|for)|best way to)\b.{0,30}\b(cheat|scam|deceive|manipulate|blackmail|defraud|trick|con|exploit|stalk|threaten|spy on|gaslight|bribe|fool|lie to|get rid of|take revenge on)\s+(on\s+)?(him|her|them|me|you|someone|somebody|people|everyone|(my|our|a|an|the|this|that)\s+(boss|manager|colleague|coworker|co-worker|team ?mate|friend|customer|client|prospect|partner|vendor|employee|person|user|wife|husband|girlfriend|boyfriend))\b/i,
  // the same verbs aimed at a named person ("cheat Rahul"); case-sensitive
  // so "scam detection" or "anti-cheat module" don't match.
  /(^\s*|\b(?:[Hh]ow (?:do I|do i|to|can I|can i)|[Hh]elp me|[Ww]ays? to|I (?:want|need) to)\s+)([Cc]heat|[Ss]cam|[Dd]efraud|[Bb]lackmail|[Tt]hreaten|[Ss]talk|[Hh]arass|[Bb]ully|[Bb]ribe|[Mm]anipulate|[Dd]eceive|[Tt]rick)\s+(on\s+)?(?!(?:Detection|Prevention|Protection|Alerts?|Reports?|Polic(?:y|ies)|Sheets?|Modules?|Analysis|Analytics|Management|Monitoring|Check|Testing|Cases?|Stud(?:y|ies)|Training|Awareness|Rules?|Scenarios?)\b)[A-Z][a-z]+\b(\s+\S+){0,3}\s*[?.!]?\s*$/,
  /\b(how (do i|to|can i)|help me|ways? to)\b.{0,15}\b(cheat|scam|defraud|blackmail|stalk|harass|bully)\b\s*\??$/i,
  // hate and harassment
  /\b(racist|sexist|homophobic)\s+(joke|jokes|insult|insults|slur|slurs)\b/i,
  /\b(insult|abuse|harass|bully|humiliate|roast)\b.{0,20}\b(him|her|them|my (boss|manager|colleague|coworker))\b/i,
];

// Words the answer must never contain. Kept to unambiguous terms so normal
// business text never trips it. Partial stems catch common variants.
const BLOCKED_OUTPUT = /\b(fuck\w*|shit\w*|bitch\w*|cunt\w*|asshole\w*|motherf\w*|bastard\w*|slut\w*|whore\w*|porn\w*|n[i1]gg\w*|f[a@]gg?[o0]t\w*|retard(ed|s)?|dickhead\w*|wank\w*)\b/i;

// Creative or chit-chat requests: harmless, but not what this assistant is
// for, and a small model asked for them tends to drift off the documents.
const OFF_TOPIC = /\b(tell|write|make|give|compose|create)\b.{0,25}\b(jokes?|poems?|poetry|songs?|lyrics|raps?|limericks?|riddles?|haikus?)\b/i;

/** Screens a user question before anything else runs. */
export function checkQuestion(text: string): GuardResult {
  if (SELF_HARM.test(text)) {
    return {
      ok: false,
      reason: "self_harm",
      answer:
        "I'm only able to help with documents here, but it sounds like you might be going through something difficult. Please reach out to someone you trust, or a local helpline or emergency service, so you can talk to someone right away.",
    };
  }
  if (INJECTION.some((r) => r.test(text))) {
    return { ok: false, reason: "injection", answer: "I can't change how I work or share my instructions. " + OUT_OF_SCOPE };
  }
  if (DISALLOWED.some((r) => r.test(text)) || BLOCKED_OUTPUT.test(text)) {
    return { ok: false, reason: "harmful", answer: "I can't help with that. " + OUT_OF_SCOPE };
  }
  if (OFF_TOPIC.test(text)) return { ok: false, reason: "off_topic", answer: OUT_OF_SCOPE };
  return { ok: true };
}

// Credentials and card numbers sometimes end up inside uploaded documents
// (setup guides, pasted configs). Masked both in the excerpts sent to the
// model and in anything it writes back.
const SECRET_PATTERNS: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  [/\b(password|passwd|pwd|passcode|api[ _-]?key|secret(?:[ _-]?key)?|access[ _-]?token|auth[ _-]?token|client[ _-]?secret)(\s*[:=]\s*)("[^"]+"|'[^']+'|\S+)/gi, (_m, k, sep) => `${k}${sep}[hidden]`],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[hidden]"],
  [/\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{20,}\b/g, "[hidden]"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, "[hidden]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[hidden]"],
  [/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[hidden]" : m)],
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Model-written text that's safe to show as is (no blocked language), with secrets masked; null if not. */
export function cleanReply(text: string): string | null {
  return BLOCKED_OUTPUT.test(text) ? null : redactSecrets(text);
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep as any);
  return out;
}

// Phrases the model uses when the documents didn't answer the question.
const NOT_FOUND =
  /\b(couldn'?t|could not|can'?t|cannot|unable to|wasn'?t able to|did not|didn'?t)\s+(find|locate|answer|provide|see)|\b(do|does|did)\s?(n[o']t|not)\s+(contain|include|mention|cover|have|provide|appear)|\bno (information|details|mention|specific|relevant|documents?)\b|\bnot (mentioned|covered|available|provided|found|included)\b|\bthere (is|are) no\b/i;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Which of the offered documents the answer actually drew on: those it
 * names by title (or as "Document N", the label used in the prompt). An
 * answer that names none and says it couldn't find the information cites
 * nothing; one that names none but did answer is credited to the single
 * best match, since that's what the context was built around.
 */
export function citedSourceIds(answer: string, sources: { id: string; title: string }[]): string[] {
  const text = normalize(answer);
  const cited = sources.filter((s, i) => {
    const title = normalize(s.title);
    return (title.length >= 3 && text.includes(title)) || new RegExp(`\\bdocument ${i + 1}\\b`).test(text);
  });
  if (cited.length) return cited.map((s) => s.id);
  if (NOT_FOUND.test(answer) || !sources.length) return [];
  return [sources[0].id];
}

export type AnswerMeta = {
  // Ids of the sources the answer used; the client shows only these.
  sources: string[];
  notice?: string;
  blocked?: boolean;
};

// Separates the answer text from the metadata record sent after it on the
// same stream. A control character that never appears in model output.
export const META_SEPARATOR = "\u001e";

const HOLDBACK = 80; // chars kept back so a term split across chunks is still caught
const LONG_LINE = 240; // lines longer than this stream out before they end

/**
 * Filters the model's answer as it streams:
 * - masks credentials and card numbers;
 * - stops the answer (and says why) if it contains blocked language;
 * - drops lines the model has already written and stops a runaway loop;
 * - strips echoes of the grounding reminder appended to the question.
 * When the stream ends, appends META_SEPARATOR + JSON(AnswerMeta) so the
 * client learns which sources were used and whether the answer was cut.
 */
export function guardAnswerStream(
  input: ReadableStream<Uint8Array>,
  opts: {
    sources: { id: string; title: string }[];
    wasTruncated: () => boolean;
    onBlocked?: () => void;
  }
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let pending = ""; // received, not yet sent
  let sent = ""; // everything sent so far (for the final source check)
  let lineStreamed = false; // current line already partly sent, can't dedupe it
  // How often each line has been written. Real answers can repeat a line
  // or two (each pricing tier says "Seamless updates"), so only a third
  // copy is dropped, and only a line written five times means a loop.
  const seenLines = new Map<string, number>();
  let stopped: "blocked" | "loop" | null = null;

  const emit = (out: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (!text) return;
    sent += text;
    out.enqueue(encoder.encode(text));
  };

  const cleanLine = (line: string) => line.replace(/\(?Answer only from the context documents[^)\n]*\)?/gi, "");

  // Sends whatever of `pending` is safe to send. `final` flushes everything.
  const flush = (out: ReadableStreamDefaultController<Uint8Array>, final: boolean) => {
    if (BLOCKED_OUTPUT.test(sent.slice(-HOLDBACK) + pending)) {
      stopped = "blocked";
      return;
    }
    // Whole lines first: they can be checked for repeats.
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      const key = normalize(line);
      const seen = key.length >= 15 ? (seenLines.get(key) ?? 0) + 1 : 0;
      if (seen) seenLines.set(key, seen);
      if (seen >= 5) {
        stopped = "loop";
        return;
      }
      if (!lineStreamed && seen >= 3) continue;
      emit(out, redactSecrets(cleanLine(line)) + "\n");
      lineStreamed = false;
    }
    // A model stuck repeating a phrase within one line.
    if (/(.{12,}?)\1{4,}$/s.test(pending)) {
      stopped = "loop";
      return;
    }
    if (final) {
      emit(out, redactSecrets(cleanLine(pending)));
      pending = "";
    } else if (pending.length > LONG_LINE) {
      // Long paragraph: stream all but the held-back tail so it doesn't
      // appear in one jump at the end.
      const cut = pending.lastIndexOf(" ", pending.length - HOLDBACK);
      if (cut > 0) {
        emit(out, redactSecrets(cleanLine(pending.slice(0, cut + 1))));
        pending = pending.slice(cut + 1);
        lineStreamed = true;
      }
    }
  };

  const finish = (out: ReadableStreamDefaultController<Uint8Array>) => {
    const meta: AnswerMeta = { sources: citedSourceIds(sent, opts.sources) };
    if (stopped === "blocked") {
      meta.blocked = true;
      meta.sources = [];
      meta.notice = "This answer was stopped because it included language that isn't allowed here.";
    } else if (stopped === "loop") {
      meta.notice = "The answer started repeating itself, so it was cut short.";
    } else if (opts.wasTruncated()) {
      meta.notice = "This answer reached its length limit. Ask a narrower question to get the rest.";
    }
    out.enqueue(encoder.encode(META_SEPARATOR + JSON.stringify(meta)));
    out.close();
  };

  return new ReadableStream<Uint8Array>({
    async pull(out) {
      while (true) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (err) {
          if (!sent && !pending) {
            out.error(err);
            return;
          }
          flush(out, true);
          finish(out);
          return;
        }
        if (result.done) {
          pending += decoder.decode();
          flush(out, true);
          if (!sent.trim() && !stopped) {
            out.error(new Error("empty answer"));
            return;
          }
          finish(out);
          return;
        }
        const before = sent.length;
        pending += decoder.decode(result.value, { stream: true });
        flush(out, false);
        if (stopped) {
          if (stopped === "blocked") opts.onBlocked?.();
          reader.cancel().catch(() => {});
          finish(out);
          return;
        }
        if (sent.length > before) return;
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
