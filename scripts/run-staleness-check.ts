import "dotenv/config";
/**
 * Daily scheduled job (cron on the Oracle VM, or Supabase Edge Function
 * on a schedule) that flags documents likely to be outdated.
 *
 * Two layers, cheapest check first:
 *   1. Rule-based (instant, free, no AI): compares lastReviewedAt against
 *      the category's reviewCycleDays.
 *   2. AI-assisted (open-source, self-hosted — no paid API): asks a local
 *      Ollama model to read the doc's changelog + extracted text and flag
 *      anything that reads as version-stale (e.g. references an old
 *      product version, a competitor feature that's since shipped
 *      elsewhere, screenshots of an old UI, etc.)
 *
 * Run: npm run staleness:run
 * Requires Ollama running locally with a pulled model, e.g.:
 *   ollama pull llama3.1:8b
 */

import { prisma } from "../lib/prisma";
import { notifyDocumentFlaggedStale } from "../lib/notify";
import { computeReviewDueDate } from "../lib/reviewDue";
import "dotenv/config";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

/** Raises a flag and notifies the owner — but only the first time an issue
 * is spotted. Without this, a doc that stays stale would get re-flagged (and
 * re-notified) on every single daily run for as long as it stays unresolved. */
async function raiseStalenessFlag(doc: { id: string; title: string; owner: { name: string } }, reason: string, severity: string) {
  const alreadyFlagged = await prisma.stalenessFlag.findFirst({
    where: { documentId: doc.id, resolved: false },
  });
  if (alreadyFlagged) return;

  await prisma.stalenessFlag.create({
    data: { documentId: doc.id, reason, severity },
  });
  await notifyDocumentFlaggedStale({
    ownerName: doc.owner.name,
    documentTitle: doc.title,
    documentId: doc.id,
    reason,
  });
}

async function ruleBasedCheck() {
  const docs = await prisma.document.findMany({
    where: { status: "published", neverExpires: false },
    include: { category: true, owner: true },
  });

  const now = Date.now();
  for (const doc of docs) {
    const dueDate = computeReviewDueDate(doc, doc.category.reviewCycleDays);
    const overdueDays = (now - dueDate.getTime()) / (1000 * 60 * 60 * 24);
    if (overdueDays > 0) {
      await raiseStalenessFlag(
        doc,
        `Review overdue by ${Math.floor(overdueDays)} day(s)`,
        doc.category.reviewCycleDays !== null && overdueDays > doc.category.reviewCycleDays ? "critical" : "warning"
      );
    }
  }
}

async function aiAssistedCheck() {
  const docs = await prisma.document.findMany({
    where: { status: "published", neverExpires: false },
    include: { currentVersion: true, category: true, owner: true },
  });

  for (const doc of docs) {
    const text = doc.currentVersion?.extractedText;
    if (!text) continue;

    const prompt = `You review internal sales/demo documents for staleness.
Category: ${doc.category.name}
Title: ${doc.title}
Content excerpt (first 2000 chars): ${text.slice(0, 2000)}

Does this content reference outdated version numbers, deprecated features,
old UI screenshots, or superseded competitor claims? Reply with exactly one
line: "STALE: <short reason>" or "OK".`;

    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
    });
    const data = await res.json();
    const answer: string = data.response?.trim() ?? "";

    if (answer.startsWith("STALE:")) {
      await raiseStalenessFlag(doc, answer.replace("STALE:", "").trim(), "warning");
    }
  }
}

async function main() {
  await ruleBasedCheck();
  await aiAssistedCheck();
  console.log("Staleness check complete.");
}

main().finally(() => prisma.$disconnect());

