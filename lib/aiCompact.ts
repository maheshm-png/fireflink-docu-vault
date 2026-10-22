import { completeText, countTokens } from "./llm";
import { redactSecrets } from "./aiGuard";
import type { ChatTurn } from "./assistant";

export const MAX_SUMMARY_CHARS = 2_000;

/**
 * Folds older turns of a conversation (plus any earlier summary) into one
 * short summary, so a long chat keeps its context without sending every
 * turn to the model each time. The summary is context only: answers still
 * come from the documents, never from it.
 */
export async function compactConversation(
  turns: ChatTurn[],
  previousSummary = ""
): Promise<{ summary: string; tokens: number } | null> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 1_200)}`)
    .join("\n");
  const result = await completeText(
    [
      {
        role: "system",
        content:
          "Summarize this conversation between a user and a document assistant so it can continue later. Include: what the user asked about, the exact titles of documents discussed, and the key facts the assistant gave. Leave out greetings and anything off-topic. At most 150 words, plain text, no headings.",
      },
      {
        role: "user",
        content: `${previousSummary ? `Earlier summary:\n${previousSummary}\n\n` : ""}Conversation:\n${transcript}`,
      },
    ],
    { maxTokens: 320, timeoutMs: 30_000 }
  );
  if (!result?.text.trim()) return null;
  const summary = redactSecrets(result.text.trim()).slice(0, MAX_SUMMARY_CHARS);
  return { summary, tokens: result.tokens || (await countTokens(transcript)) };
}
