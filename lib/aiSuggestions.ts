import { prisma } from "./prisma";
import { documentAccessWhere, seesAllRestricted, type AccessUser } from "./access";
import { completeJson } from "./llm";

export type VaultOverview = {
  // Categories this user can see documents in, with how many.
  categories: { name: string; count: number }[];
  // Most recently updated documents this user can see.
  recent: { title: string; category: string }[];
};

/** What this user can see in the vault, for the model to write replies and suggestions from. */
export async function vaultOverview(user: AccessUser): Promise<VaultOverview> {
  try {
    const where = {
      status: "published" as const,
      ...(seesAllRestricted(user) ? {} : documentAccessWhere(user)),
    };
    const [docs, grouped] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { title: true, category: { select: { name: true, isSystem: true } } },
      }),
      prisma.document.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
    ]);
    const names = await prisma.category.findMany({
      // The built-in team category is plumbing, not a topic worth suggesting.
      where: { id: { in: grouped.map((g) => g.categoryId) }, isSystem: false },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((c) => [c.id, c.name]));
    return {
      categories: grouped
        .map((g) => ({ name: nameOf.get(g.categoryId) ?? "", count: g._count._all }))
        .filter((c) => c.name)
        .sort((a, b) => b.count - a.count),
      recent: docs.map((d) => ({ title: d.title, category: d.category.isSystem ? "team space" : d.category.name })),
    };
  } catch (err) {
    console.error("Assistant vault overview failed:", err);
    return { categories: [], recent: [] };
  }
}

export function describeOverview(o: VaultOverview): string {
  if (!o.recent.length) return "The user can't see any published documents yet.";
  return [
    `Categories the user can see: ${o.categories.map((c) => `${c.name} (${c.count})`).join(", ")}.`,
    `Recently updated documents: ${o.recent.map((d) => `"${d.title}" (${d.category})`).join("; ")}.`,
  ].join("\n");
}

const cache = new Map<string, { at: number; suggestions: string[] }>();
const CACHE_MS = 10 * 60_000;

/**
 * Starter questions written by the model from the documents this user can
 * actually see, so they always point at something real (and never at a
 * team document the user can't open). Cached per user for ten minutes.
 */
export async function suggestionsFor(user: AccessUser, count = 3): Promise<string[]> {
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.suggestions;

  const overview = await vaultOverview(user);
  if (!overview.recent.length) return [];

  const result = await completeJson(
    [
      {
        role: "system",
        content: `Write ${count + 2} short, varied questions (each under 12 words) a colleague could ask a document assistant about the documents listed. Base every question on the real titles and categories given; mix summarizing a document, finding documents in a category, and asking about the content of one of them (what it covers, its key points, a topic its title suggests). Never ask about a document's status, metadata, or which category it's in. Use exact titles in quotes when naming a document.`,
      },
      { role: "user", content: describeOverview(overview) },
    ],
    {
      type: "object",
      properties: { questions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: count + 2 } },
      required: ["questions"],
    },
    { maxTokens: 160, timeoutMs: 8_000 }
  );

  let suggestions = ((result?.value as any)?.questions ?? [])
    .filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 5 && q.length <= 120)
    // Questions about where a document is filed or its status aren't useful starters.
    .filter((q: string) => !/\b(categor(y|ies)|status|belongs?|filed|uploaded|metadata)\b/i.test(q))
    .map((q: string) => q.trim())
    .slice(0, count);

  // Model unreachable: fall back to questions built from the same real titles.
  if (!suggestions.length) {
    suggestions = overview.recent.slice(0, count).map((d) => `Summarize "${d.title}"`);
  }
  cache.set(user.id, { at: Date.now(), suggestions });
  return suggestions;
}
