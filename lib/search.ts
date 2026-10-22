import { MeiliSearch } from "meilisearch";
import { prisma } from "./prisma";
import { documentAccessWhere, searchAccessFilter, type AccessUser } from "./access";

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
  await index.updateFilterableAttributes(FILTERABLE_ATTRIBUTES);
  await index.updateSortableAttributes(["updatedAt"]);
}

// visibility/accessTeamIds/stakeholderIds carry the team access rule (see
// lib/access.ts's searchAccessFilter). Kept in one list so setup and the
// self-healing check below can't disagree.
const FILTERABLE_ATTRIBUTES = [
  "categoryName",
  "docType",
  "status",
  "uploadedByName",
  "isStale",
  "duplicateOfTitle",
  "visibility",
  "accessTeamIds",
  "stakeholderIds",
];

// Every search now filters on the access attributes above. If a deploy
// forgot `npm run search:setup`, Meilisearch would reject those filters and
// search would come back empty for everyone, so the first search in each
// process adds any missing filterable attribute itself and waits for it to
// apply. Only ever adds (never replaces an existing setup), and costs one
// cheap settings read once per process when nothing is missing.
let accessAttributesReady: Promise<void> | null = null;
function ensureAccessAttributes(): Promise<void> {
  if (!accessAttributesReady) {
    accessAttributesReady = (async () => {
      const index = client.index(INDEX);
      const current = await index.getFilterableAttributes();
      const missing = FILTERABLE_ATTRIBUTES.filter((a) => !current.includes(a));
      if (missing.length === 0) return;
      const task = await index.updateFilterableAttributes([...current, ...missing]);
      await client.waitForTask(task.taskUid, { timeOutMs: 60_000 });
    })().catch((err) => {
      accessAttributesReady = null; // retry on the next search
      throw err;
    });
  }
  return accessAttributesReady;
}

/** Search filters with this user's access rule appended. Every search on
 * behalf of a signed-in user must go through this, see lib/access.ts. */
export function withAccessFilter(user: AccessUser, filters: string[]): string[] {
  const access = searchAccessFilter(user);
  return access ? [...filters, access] : filters;
}

/** Access fields for one document, read from the database so callers of
 * indexDocument() never have to pass (or forget) them. */
async function accessFieldsFor(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      visibility: true,
      reviewBypassed: true,
      category: { select: { name: true } },
      uploadedById: true,
      ownerId: true,
      teamAccess: { select: { teamId: true, team: { select: { name: true } } } },
      reviewRequests: { select: { reviewerId: true } },
    },
  });
  if (!doc) return null;
  return {
    visibility: doc.visibility,
    reviewBypassed: doc.reviewBypassed,
    // Changes when a team document goes to everyone (lib/teamCategory.ts).
    categoryName: doc.category.name,
    accessTeamIds: doc.teamAccess.map((a) => a.teamId),
    accessTeamNames: doc.teamAccess.map((a) => a.team.name).sort(),
    stakeholderIds: [...new Set([doc.uploadedById, doc.ownerId, ...doc.reviewRequests.map((r) => r.reviewerId)])],
  };
}

/** Re-syncs just the access fields of an already-indexed document, after
 * its visibility/teams or reviewers change. Skips documents that aren't in
 * the index (a partial update would otherwise create a half-empty entry). */
export async function refreshIndexedAccess(id: string) {
  try {
    const fields = await accessFieldsFor(id);
    if (!fields) return;
    try {
      await client.index(INDEX).getDocument(id, { fields: ["id"] });
    } catch {
      return; // not indexed (not published yet), nothing to refresh
    }
    await client.index(INDEX).updateDocuments([{ id, ...fields }], { primaryKey: "id" });
  } catch (err) {
    console.error(`Meilisearch refreshIndexedAccess failed for ${id} (search index may be stale):`, err);
  }
}

/** Replaces just the full text of an already-indexed document (e.g. once a
 * video has been read in the background, lib/videoText.ts). */
export async function updateIndexedText(id: string, extractedText: string) {
  try {
    try {
      await client.index(INDEX).getDocument(id, { fields: ["id"] });
    } catch {
      return; // not indexed (not published yet): indexDocument picks the text up on publish
    }
    await client.index(INDEX).updateDocuments([{ id, extractedText }], { primaryKey: "id" });
  } catch (err) {
    console.error(`Meilisearch updateIndexedText failed for ${id} (search index may be stale):`, err);
  }
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
    const access = await accessFieldsFor(doc.id);
    await client.index(INDEX).addDocuments([{ ...doc, ...access, dateLabel }], { primaryKey: "id" });
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
    await ensureAccessAttributes();
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
 * Only documents visible to everyone are counted: Home lists those alone,
 * and restricted documents live in Team Space.
 */
export async function publishedCountsByCategory(user: AccessUser): Promise<Map<string, number>> {
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
      ? await prisma.document.findMany({
          where: { AND: [{ id: { in: ids }, deletedAt: null, visibility: "org" }, documentAccessWhere(user)] },
          select: { categoryId: true, extraCategories: { select: { categoryId: true } } },
        })
      : [];
    // A document counts in its main category and every "Also show in" one.
    const counts = new Map<string, number>();
    for (const d of docs) {
      for (const c of [d.categoryId, ...d.extraCategories.map((e) => e.categoryId)]) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
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
    await ensureAccessAttributes();
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

/**
 * Indexed documents by id (missing ids are skipped). No access filtering
 * here: `id` isn't a filterable attribute, so callers must check access
 * themselves (the AI assistant re-checks every id with visibleDocumentIds).
 */
export async function getIndexedDocuments(ids: string[]): Promise<Record<string, any>[]> {
  const docs = await Promise.all(
    ids.map((id) => client.index(INDEX).getDocument(id).catch(() => null))
  );
  return docs.filter((d): d is Record<string, any> => !!d);
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
