"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type FilterableField = { id: string; label: string; values: string[] };

// Generic per-category custom-field filter row — for whichever category is
// currently selected, one dropdown per custom field that actually has more
// than one distinct value among the documents currently in view (a field
// with only one value, or none, isn't worth a filter control). Values are
// derived from the real data present, not the field's declared schema
// options, so it works the same whether the field is a dropdown, free text,
// date, or number.
export default function CategoryFieldFilters({ basePath, fields }: { basePath: string; fields: FilterableField[] }) {
  const router = useRouter();
  const params = useSearchParams();

  if (fields.length === 0) return null;

  function setFieldFilter(fieldId: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(`f_${fieldId}`, value);
    else next.delete(`f_${fieldId}`);
    router.push(`${basePath}?${next.toString()}`);
    router.refresh();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-ff-textMuted">Filter by:</span>
      {fields.map((f) => (
        <select
          key={f.id}
          value={params.get(`f_${f.id}`) ?? ""}
          onChange={(e) => setFieldFilter(f.id, e.target.value)}
          className="rounded-ff border border-ff-border bg-white px-2.5 py-1.5 text-xs text-ff-text"
        >
          <option value="">{f.label}: Any</option>
          {f.values.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
