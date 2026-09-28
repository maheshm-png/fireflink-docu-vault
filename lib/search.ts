import { MeiliSearch } from "meilisearch";
import { prisma } from "./prisma";

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST!, // self-hosted on the Oracle VM alongside MinIO
  apiKey: process.env.MEILISEARCH_API_KEY,
});

const INDEX = "documents";

export async function ensureIndexConfigured() {
  const index = client.index(INDEX);
  // Universal search: one query box matches doc name, content, category,
  // tags, uploader, AND date — uploadedByName/dateLabel used to be
  // filterable-only, which meant typing an uploader's name or a date got
  // zero results even though the data was already sitting right there in
  // the index. dateLabel is computed in indexDocument() below.
  await index.updateSearchableAttributes(["title", "tags", "categoryName", "extractedText", "uploadedByName", "dateLabel"]);
  await index.updateFilterableAttributes(["categoryName", "docType", "status", "uploadedByName", "isStale", "duplicateOfTitle"]);
  await index.updateSortableAttributes(["updatedAt"]);
}

export async function indexDocument(doc: {
  id: string;
  title: string;
  tags: string[];
  categoryName: string;
  docType: string;
  status: string;
  extractedText?: string;
  uploadedByName: string;
  isStale: boolean;
  updatedAt: string;
  duplicateOfTitle?: string | null;
  // Whether the current version has a LibreOffice-converted PDF (see
  // lib/officeConvert.ts) — the dashboard's quick-preview reads this straight
  // off the search result (components/DocumentTable.tsx, DocumentGrid.tsx) to
  // decide whether it can use the accurate PDF viewer instead of the
  // lighter-weight PPT/Excel approximation, so it has to travel with the
  // rest of the indexed document rather than requiring a second lookup.
  hasPreviewPdf?: boolean;
}) {
  // A few human-readable renderings of the same updatedAt so a typed date
  // actually has something to match against — e.g. "2026-08-26", "August
  // 26, 2026", "Aug 2026" all hit the same document. Computed here (not by
  // every caller) so no call site needs to change to pick this up.
  const d = new Date(doc.updatedAt);
  const dateLabel = [
    d.toISOString().slice(0, 10),
    d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  ].join(" ");

  // Best-effort: the caller has already committed the real DB state change
  // (approve/revoke/delete/restore/edit) by the time this runs. If the
  // self-hosted Meilisearch instance is down, the search index just goes
  // stale rather than turning an already-successful action into a
  // misleading 500 for the user.
  try {
    await client.index(INDEX).addDocuments([{ ...doc, dateLabel }], { primaryKey: "id" });
  } catch (err) {
    console.error(`Meilisearch indexDocument failed for ${doc.id} (search index may be stale):`, err);
  }
}

export async function removeFromIndex(id: string) {
  try {
    await client.index(INDEX).deleteDocument(id);
  } catch (err) {
    console.error(`Meilisearch removeFromIndex failed for ${id} (search index may be stale):`, err);
  }
}

export async function search(query: string, filters: string[] = [], limit = 25) {
  try {
    return await client.index(INDEX).search(query, {
      filter: filters.length ? filters.join(" AND ") : undefined,
      limit,
    });
  } catch (err) {
    // Best-effort, same philosophy as indexDocument/removeFromIndex above —
    // a self-hosted Meilisearch outage (its Docker container restarting
    // after the host machine wakes from sleep, say) used to crash the
    // entire Published Documents page with an unhandled exception for
    // every viewer. Degrading to "no results" keeps the rest of the page
    // usable while the outage shows up in server logs instead of a blank
    // crash screen.
    console.error(`Meilisearch search failed for query "${query}" (index may be unreachable):`, err);
    return { hits: [], processingTimeMs: 0, query, limit, offset: 0 };
  }
}

/**
 * Published-document count per category ID. Which documents are published
 * comes from the search index (the same source the Published Documents list
 * reads from, so a tab or Home tile count always equals what it lists), but
 * which category each belongs to comes from the database. Matching on the
 * indexed categoryName instead broke whenever a category was renamed: every
 * document indexed before the rename still carried the old name, so the
 * renamed tab counted and listed nothing. Soft-deleted documents that are
 * still in the index are skipped too. Empty map on an outage, same
 * best-effort fallback as search() (the list would be empty then too).
 */
export async function publishedCountsByCategory(): Promise<Map<string, number>> {
  try {
    const ids: string[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = await client
        .index(INDEX)
        .getDocuments<{ id: string; status: string }>({ fields: ["id", "status"], limit: pageSize, offset });
      ids.push(...page.results.filter((d) => d.status === "published").map((d) => d.id));
      if (page.results.length < pageSize) break;
    }
    const docs = ids.length
      ? await prisma.document.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { categoryId: true } })
      : [];
    const counts = new Map<string, number>();
    for (const d of docs) counts.set(d.categoryId, (counts.get(d.categoryId) ?? 0) + 1);
    return counts;
  } catch (err) {
    console.error("Meilisearch category counts failed (index may be unreachable):", err);
    return new Map();
  }
}

/**
 * Same as search(), but for callers (the AI assistant) that need to know
 * whether a hit is an actual topical match versus Meilisearch's fallback
 * behavior of still returning its best-effort guess even when nothing
 * really matches. Meilisearch's normalized _rankingScore cleanly separates
 * the two in practice — genuine matches score ~0.95+, fallback noise scores
 * well under 0.2 — so filtering below rankingScoreThreshold keeps only
 * hits worth treating as "relevant content found."
 */
export async function searchScored(query: string, filters: string[] = [], limit = 25, rankingScoreThreshold = 0.4) {
  try {
    return await client.index(INDEX).search(query, {
      filter: filters.length ? filters.join(" AND ") : undefined,
      limit,
      showRankingScore: true,
      rankingScoreThreshold,
    });
  } catch (err) {
    // Same fallback as search() above — a Meilisearch outage shouldn't
    // break the AI assistant either, it should just have nothing to cite.
    console.error(`Meilisearch searchScored failed for query "${query}" (index may be unreachable):`, err);
    return { hits: [], processingTimeMs: 0, query, limit, offset: 0 };
  }
}

/** Every indexed document's id and categoryName, paged through the whole index. */
export async function allIndexedCategoryNames(): Promise<{ id: string; categoryName: string }[]> {
  const out: { id: string; categoryName: string }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await client
      .index(INDEX)
      .getDocuments<{ id: string; categoryName: string }>({ fields: ["id", "categoryName"], limit: pageSize, offset });
    out.push(...page.results);
    if (page.results.length < pageSize) return out;
  }
}

/**
 * Sets categoryName on already-indexed documents. The index stores the
 * category's NAME (the Published list, its tab counts and the Home tiles
 * all filter/facet on it), so renaming a category without this left every
 * document in it matching the old name only, and the renamed tab showed
 * nothing. Partial update: only ids that are actually in the index are
 * passed in, so nothing half-empty gets created. Best-effort like the rest.
 */
export async function setIndexedCategoryName(ids: string[], categoryName: string) {
  if (ids.length === 0) return;
  try {
    await client.index(INDEX).updateDocuments(ids.map((id) => ({ id, categoryName })), { primaryKey: "id" });
  } catch (err) {
    console.error(`Meilisearch category rename to "${categoryName}" failed (search index may be stale):`, err);
  }
}
