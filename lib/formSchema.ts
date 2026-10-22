/**
 * A manager builds one of these arrays per category. Every upload into
 * that category renders these fields and requires the required ones
 * before the file can be submitted — see app/dashboard/upload/page.tsx.
 */
export type CategoryFieldType = "text" | "textarea" | "select" | "date" | "number" | "checkbox";

export type CategoryFormField = {
  id: string;          // slug, used as the key in Document.metadata
  label: string;       // shown to the uploader
  type: CategoryFieldType;
  required: boolean;
  options?: string[];  // only used when type === "select"
};

export function slugifyFieldId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

const FIELD_TYPES: CategoryFieldType[] = ["text", "textarea", "select", "date", "number", "checkbox"];

/** Whether a request body's formSchema has the shape the upload form and
 * validateMetadataAgainstSchema rely on. The category routes reject anything
 * else, since a malformed schema would break every upload into the category. */
export function isFormSchema(value: unknown): value is CategoryFormField[] {
  return (
    Array.isArray(value) &&
    value.every(
      (f) =>
        f &&
        typeof f === "object" &&
        typeof f.id === "string" &&
        f.id.length > 0 &&
        typeof f.label === "string" &&
        FIELD_TYPES.includes(f.type) &&
        typeof f.required === "boolean" &&
        (f.options === undefined || (Array.isArray(f.options) && f.options.every((o: unknown) => typeof o === "string")))
    )
  );
}

/** A category's review cycle from a request body: null (no cycle) or a whole
 * number of days from 1 to 3650. undefined when it isn't valid. */
export function parseReviewCycleDays(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3650 ? (value as number) : undefined;
}

/** Ensures field ids are unique within a schema (appends _2, _3, ... on collision). */
export function dedupeFieldIds(fields: CategoryFormField[]): CategoryFormField[] {
  const seen = new Map<string, number>();
  return fields.map((f) => {
    const count = seen.get(f.id) ?? 0;
    seen.set(f.id, count + 1);
    return count === 0 ? f : { ...f, id: `${f.id}_${count + 1}` };
  });
}

/**
 * Server-side validation — never trust the client alone to have enforced
 * "required" fields, since the API can be called directly.
 */
export function validateMetadataAgainstSchema(
  schema: CategoryFormField[],
  metadata: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const missing = schema
    .filter((f) => f.required)
    .filter((f) => {
      const v = metadata[f.id];
      if (f.type === "checkbox") return v !== true && v !== false;
      return v === undefined || v === null || v === "";
    })
    .map((f) => f.label);

  return { valid: missing.length === 0, missing };
}
