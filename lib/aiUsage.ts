// Per-user limits for Ask Docu AI, so one person (or a stuck script) can't
// use up the shared model. Kept in memory: the app runs as one process, and
// losing the counters on a restart only ever errs in the user's favour.
const PER_MINUTE = Number(process.env.AI_QUESTIONS_PER_MINUTE) || 8;
const DAILY_TOKENS = Number(process.env.AI_DAILY_TOKENS_PER_USER) || 300_000;

type Usage = { recent: number[]; day: string; tokens: number; inFlight: boolean };
const usage = new Map<string, Usage>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function entry(userId: string): Usage {
  let u = usage.get(userId);
  if (!u) {
    u = { recent: [], day: today(), tokens: 0, inFlight: false };
    usage.set(userId, u);
  }
  if (u.day !== today()) {
    u.day = today();
    u.tokens = 0;
  }
  return u;
}

export type Allowance = { ok: true; release: () => void } | { ok: false; status: number; error: string };

/**
 * Checks a user may ask now and, if so, marks a question as in flight.
 * The caller must call release() when the answer ends, however it ends.
 */
export function startQuestion(userId: string): Allowance {
  const u = entry(userId);
  const now = Date.now();
  u.recent = u.recent.filter((t) => now - t < 60_000);

  if (u.inFlight) {
    return { ok: false, status: 429, error: "Please wait for the current answer to finish before asking another question." };
  }
  if (u.recent.length >= PER_MINUTE) {
    return { ok: false, status: 429, error: "You're asking questions very quickly. Please wait a minute and try again." };
  }
  if (u.tokens >= DAILY_TOKENS) {
    return { ok: false, status: 429, error: "You've reached today's Ask Docu AI limit. It resets at midnight (UTC)." };
  }

  u.recent.push(now);
  u.inFlight = true;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      u.inFlight = false;
    },
  };
}

/** Adds the tokens one answer used (prompt + answer) to the user's daily total. */
export function recordTokens(userId: string, tokens: number) {
  entry(userId).tokens += Math.max(0, tokens);
}
