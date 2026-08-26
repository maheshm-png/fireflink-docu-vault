import { MeiliSearch } from "meilisearch";

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
  return client.index(INDEX).search(query, {
    filter: filters.length ? filters.join(" AND ") : undefined,
    limit,
  });
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
  return client.index(INDEX).search(query, {
    filter: filters.length ? filters.join(" AND ") : undefined,
    limit,
    showRankingScore: true,
    rankingScoreThreshold,
  });
}
