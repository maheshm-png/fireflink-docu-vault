import type { CategoryFormField } from "./formSchema";

/**
 * Custom document filters, shared by every document listing (Published
 * Documents per category tab, Review Dashboard per status tab, Revoked
 * Documents). The filter lives entirely in the page's query string, so a
 * saved filter (the SavedFilter model) is just a stored set of those
 * query-string pairs, and applying one is plain navigation.
 *
 * Pure functions only: imported by server pages (to filter) and by
 * components/DocumentFilters.tsx (to know which keys are filter keys).
 */

// Every document the filters run over, normalized from whatever each page
// loads (search hits + Prisma rows on Published, Prisma rows elsewhere).
export type FilterableDoc = {
  id: string;
  title: string;
  tags: string[];
  docType: string;
  categoryId: string;
  categoryName: string;
  uploadedByName: string;
  ownerName: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  isStale: boolean;
  isDuplicate: boolean;
  metadata: Record<string, unknown>;
};

export type CustomFieldOption = {
  id: string;
  label: string;
  type: CategoryFormField["type"];
  values: string[];
};

export type FilterOptions = {
  docTypes: string[];
  categories: { id: string; name: string }[] | null; // null: section is already one category
  uploaders: string[];
  owners: string[];
  tags: string[];
  showStale: boolean;
  customFields: CustomFieldOption[];
};

// Multi-value params are repeated in the URL (?docType=pdf&docType=ppt).
export const MULTI_KEYS = ["docType", "cat", "uploader", "owner", "tags"] as const;
export const SINGLE_KEYS = [
  "q",
  "title",
  "updatedFrom",
  "updatedTo",
  "createdFrom",
  "createdTo",
  "stale",
  "dup",
] as const;
export const CUSTOM_FIELD_PREFIX = "f_";

export function isFilterKey(key: string) {
  return (
    (MULTI_KEYS as readonly string[]).includes(key) ||
    (SINGLE_KEYS as readonly string[]).includes(key) ||
    key.startsWith(CUSTOM_FIELD_PREFIX)
  );
}

export type RawParams = Record<string, string | string[] | undefined>;

function all(params: RawParams, key: string): string[] {
  const v = params[key];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

function one(params: RawParams, key: string): string {
  return all(params, key)[0] ?? "";
}

/** The filter's [key, value] pairs, sorted, for storing and comparing saved filters. */
export function filterPairs(params: RawParams): [string, string][] {
  const pairs: [string, string][] = [];
  for (const key of Object.keys(params)) {
    if (!isFilterKey(key)) continue;
    for (const value of all(params, key)) pairs.push([key, value]);
  }
  return pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
}

export function activeFilterCount(params: RawParams) {
  return new Set(filterPairs(params).map(([k]) => k.replace(/_(min|max|from|to)$/, ""))).size;
}

const displayValue = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? ""));
const dayOf = (iso: string) => iso.slice(0, 10);
const lower = (s: string) => s.toLowerCase();

/**
 * Applies every filter in params to docs. keywordInMemory: whether "q" is
 * matched here (Review/Revoked) or was already applied by Meilisearch
 * (Published, where it also searches document content).
 */
export function applyFilters(
  docs: FilterableDoc[],
  params: RawParams,
  schema: CategoryFormField[],
  { keywordInMemory }: { keywordInMemory: boolean }
) {
  const q = lower(one(params, "q"));
  const title = lower(one(params, "title"));
  const docTypes = all(params, "docType");
  const cats = all(params, "cat");
  const uploaders = all(params, "uploader");
  const owners = all(params, "owner");
  const tags = all(params, "tags").map(lower);
  const updatedFrom = one(params, "updatedFrom");
  const updatedTo = one(params, "updatedTo");
  const createdFrom = one(params, "createdFrom");
  const createdTo = one(params, "createdTo");
  const stale = one(params, "stale") === "true";
  const dup = one(params, "dup") === "true";

  const fieldChecks = schema.flatMap((f) => {
    const key = `${CUSTOM_FIELD_PREFIX}${f.id}`;
    const checks: ((m: Record<string, unknown>) => boolean)[] = [];
    if (f.type === "number") {
      const min = one(params, `${key}_min`);
      const max = one(params, `${key}_max`);
      if (min) checks.push((m) => m[f.id] !== undefined && m[f.id] !== "" && Number(m[f.id]) >= Number(min));
      if (max) checks.push((m) => m[f.id] !== undefined && m[f.id] !== "" && Number(m[f.id]) <= Number(max));
    } else if (f.type === "date") {
      const from = one(params, `${key}_from`);
      const to = one(params, `${key}_to`);
      if (from) checks.push((m) => Boolean(m[f.id]) && String(m[f.id]).slice(0, 10) >= from);
      if (to) checks.push((m) => Boolean(m[f.id]) && String(m[f.id]).slice(0, 10) <= to);
    } else {
      const wanted = all(params, key);
      if (wanted.length === 0) return checks;
      if (f.type === "text" || f.type === "textarea") {
        const needle = lower(wanted[0]);
        checks.push((m) => lower(displayValue(m[f.id])).includes(needle));
      } else {
        checks.push((m) => wanted.includes(displayValue(m[f.id])));
      }
    }
    return checks;
  });

  return docs.filter((d) => {
    if (keywordInMemory && q) {
      const hay = [d.title, d.categoryName, d.uploadedByName, d.ownerName, ...d.tags].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (title && !lower(d.title).includes(title)) return false;
    if (docTypes.length && !docTypes.includes(d.docType)) return false;
    if (cats.length && !cats.includes(d.categoryId)) return false;
    if (uploaders.length && !uploaders.includes(d.uploadedByName)) return false;
    if (owners.length && !owners.includes(d.ownerName)) return false;
    if (tags.length && !d.tags.some((t) => tags.includes(lower(t)))) return false;
    if (updatedFrom && dayOf(d.updatedAt) < updatedFrom) return false;
    if (updatedTo && dayOf(d.updatedAt) > updatedTo) return false;
    if (createdFrom && dayOf(d.createdAt) < createdFrom) return false;
    if (createdTo && dayOf(d.createdAt) > createdTo) return false;
    if (stale && !d.isStale) return false;
    if (dup && !d.isDuplicate) return false;
    return fieldChecks.every((check) => check(d.metadata));
  });
}

/**
 * The choices each filter control offers, taken from the documents actually
 * in the section (before filtering), not every possible value, so nothing
 * offered ever matches zero documents on its own.
 */
export function buildFilterOptions(
  docs: FilterableDoc[],
  schema: CategoryFormField[],
  { withCategories, showStale }: { withCategories: boolean; showStale: boolean }
): FilterOptions {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categories = withCategories
    ? [...new Map(docs.map((d) => [d.categoryId, d.categoryName])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : null;

  const customFields = schema.map((f) => {
    const values = f.type === "number" || f.type === "date" || f.type === "textarea"
      ? []
      : uniq(docs.map((d) => d.metadata[f.id]).filter((v) => v !== undefined && v !== null && v !== "").map(displayValue));
    return { id: f.id, label: f.label, type: f.type, values };
  });

  return {
    docTypes: uniq(docs.map((d) => d.docType)),
    categories,
    uploaders: uniq(docs.map((d) => d.uploadedByName)),
    owners: uniq(docs.map((d) => d.ownerName)),
    tags: uniq(docs.flatMap((d) => d.tags)),
    showStale,
    customFields,
  };
}

/** Schema fields shared across a mixed-category section have no single meaning, so only a one-category view gets custom-field filters. */
export function schemaForSection(
  categories: { id: string; formSchema: unknown }[],
  categoryId: string | null
): CategoryFormField[] {
  if (!categoryId) return [];
  const c = categories.find((x) => x.id === categoryId);
  return ((c?.formSchema as CategoryFormField[] | undefined) ?? []).filter(Boolean);
}

// Custom filters over a Prisma-backed listing (Review Dashboard, Revoked). Category fields
// only apply once the filter narrows to exactly one category.
export function filterDocs<T extends { id: string; categoryId: string; category: { name: string; formSchema: unknown } }>(
  docs: (T & {
    title: string;
    tags: string[];
    docType: string;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
    duplicateOfId: string | null;
    uploadedBy: { name: string };
    owner: { name: string };
  })[],
  searchParams: RawParams
) {
  const filterable: FilterableDoc[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    tags: d.tags,
    docType: d.docType,
    categoryId: d.categoryId,
    categoryName: d.category.name,
    uploadedByName: d.uploadedBy.name,
    ownerName: d.owner.name,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    isStale: false,
    isDuplicate: d.duplicateOfId !== null,
    metadata: (d.metadata as Record<string, unknown>) ?? {},
  }));
  const cats = searchParams.cat === undefined ? [] : ([] as string[]).concat(searchParams.cat);
  const categories = [...new Map(docs.map((d) => [d.categoryId, { id: d.categoryId, formSchema: d.category.formSchema }])).values()];
  const schema = schemaForSection(categories, cats.length === 1 ? cats[0] : null);
  const options = buildFilterOptions(filterable, schema, { withCategories: true, showStale: false });
  const kept = new Set(applyFilters(filterable, searchParams, schema, { keywordInMemory: true }).map((d) => d.id));
  return { options, kept };
}
