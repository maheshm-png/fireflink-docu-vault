import { completeJson, type LlmMessage } from "./llm";
import type { ChatTurn } from "./assistant";

export type QuestionPlan = {
  // greeting: "hi", "thanks". about_assistant: "what can you do?".
  // document_question: anything to look up. off_topic: unrelated requests.
  intent: "greeting" | "about_assistant" | "document_question" | "off_topic";
  // The question rewritten to stand on its own ("tell me more about it" ->
  // "Tell me more about the FireFlink Platform V4 deck's pricing").
  standaloneQuestion: string;
  // Just the subject asked about, without the reason or context around it
  // ("docs on fintech, I have a client demo" -> "fintech"). Empty if none.
  topic: string;
  // Words and short phrases likely to appear in the documents that answer it.
  searchTerms: string[];
  // list: gather every matching item across documents. explain: explain a
  // topic. find_document: point to the right document(s).
  answerType: "list" | "explain" | "find_document";
  // For list answers: listing documents ("what documents do we have in X")
  // or items found inside them ("what clients / features do we have").
  listOf: "documents" | "items";
};

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["greeting", "about_assistant", "document_question", "off_topic"] },
    standalone_question: { type: "string" },
    topic: { type: "string" },
    search_terms: { type: "array", items: { type: "string" }, maxItems: 8 },
    answer_type: { type: "string", enum: ["list", "explain", "find_document"] },
    list_of: { type: "string", enum: ["documents", "items"] },
  },
  required: ["intent", "standalone_question", "topic", "search_terms", "answer_type", "list_of"],
};

const SYSTEM = `You plan searches for an assistant that answers questions from a company's internal document library (sales decks, case studies, product docs, pricing, reports).
Given the conversation and the latest message, return JSON:
- intent: "greeting" for hellos, thanks or small talk; "about_assistant" ONLY for questions about the assistant itself ("who are you", "what can you do", "how do you work"); "off_topic" for requests unrelated to company documents or work (jokes, general trivia, coding help, personal advice); otherwise "document_question". Anything about "we", "our", the company, its clients, products, pricing, people or documents is "document_question".
  Examples: "hi" -> greeting. "what can you do?" -> about_assistant. "what clients do we have?" -> document_question. "who are our customers" -> document_question. "tell me a joke" -> off_topic.
- standalone_question: the latest message rewritten so it makes sense without the conversation (resolve "it", "that", "them" from earlier turns). Keep the user's meaning, don't add facts.
- topic: just the subject the user wants information or documents about, in 1 to 4 words, leaving out why they want it and any other context and the kind of thing they want (documents, case studies, clients, examples). For example "some docs on the fintech domain, I have a demo for a client" -> "fintech"; "case studies relevant to healthcare" -> "healthcare"; "what's our pricing for private cloud?" -> "private cloud pricing". Empty for greetings.
- search_terms: 3 to 8 single words or short phrases that would literally appear in documents answering it. Always include synonyms, related words and the names of the field's typical companies, products or tasks for the topic, since documents rarely use the topic's own name (for example fintech -> banking, bank, finance, payments, lending, insurance). Never just repeat the topic with "documents", "demo" or "domain" added. Include the plain words documents use (for example a question about clients should also search customer, customers, and verbs documents use near customer names like automated, validated, delivered). No filler words.
- answer_type: "list" if the user wants every matching item (all clients, all documents about X, all features); "find_document" if they want to know which document to open; otherwise "explain".
- list_of: "documents" when the user wants to know which documents/files/decks exist (for example "what documents do we have in Demo Kit?"); "items" when they want things found inside documents (clients, features, prices, people).`;

/**
 * Asks the model to classify the message and plan the search. Fast (one
 * short, schema-constrained call) and optional: returns null on any
 * failure, and the caller falls back to plain keyword search.
 */
export async function planQuestion(question: string, history: ChatTurn[]): Promise<{ plan: QuestionPlan; tokens: number } | null> {
  const recent = history
    .slice(-4)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 400)}`)
    .join("\n");
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `${recent ? `Conversation so far:\n${recent}\n\n` : ""}Latest message: ${question}` },
  ];
  const result = await completeJson(messages, SCHEMA, { maxTokens: 260, timeoutMs: 6_000 });
  if (!result) return null;
  const v = result.value as Record<string, unknown>;
  const intents = ["greeting", "about_assistant", "document_question", "off_topic"] as const;
  const types = ["list", "explain", "find_document"] as const;
  const plan: QuestionPlan = {
    intent: intents.includes(v.intent as any) ? (v.intent as QuestionPlan["intent"]) : "document_question",
    standaloneQuestion:
      typeof v.standalone_question === "string" && v.standalone_question.trim()
        ? v.standalone_question.trim().slice(0, 500)
        : question,
    topic: typeof v.topic === "string" ? v.topic.trim().slice(0, 80) : "",
    searchTerms: Array.isArray(v.search_terms)
      ? (v.search_terms as unknown[]).filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim().slice(0, 60)).slice(0, 8)
      : [],
    answerType: types.includes(v.answer_type as any) ? (v.answer_type as QuestionPlan["answerType"]) : "explain",
    listOf: v.list_of === "items" ? "items" : "documents",
  };
  return { plan, tokens: result.tokens };
}
