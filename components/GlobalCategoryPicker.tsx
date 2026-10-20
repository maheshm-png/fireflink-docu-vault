"use client";

import { useEffect, useState } from "react";
import type { CategoryFormField } from "@/lib/formSchema";
import DynamicField from "@/components/DynamicField";
import InfoTooltip from "@/components/InfoTooltip";

type Category = { id: string; name: string; description: string | null; formSchema: CategoryFormField[] };

// Picks the global category a team document joins when it's opened to
// everyone (team documents have no category, lib/teamCategory.ts), plus that
// category's detail fields. Used by the Global approver's "Approve for
// Everyone" and a superadmin opening a team document to everyone.
export default function GlobalCategoryPicker({
  value,
  onChange,
}: {
  value: { categoryId: string; metadata: Record<string, unknown> };
  onChange: (next: { categoryId: string; metadata: Record<string, unknown> }) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => {});
  }, []);
  const selected = categories.find((c) => c.id === value.categoryId);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-ff-text">
        Category for everyone
        <InfoTooltip text="Team documents have no category, so pick where it belongs for everyone." />
      </label>
      <select
        value={value.categoryId}
        onChange={(e) => onChange({ categoryId: e.target.value, metadata: {} })}
        className="w-full rounded-ff border border-ff-border px-3 py-2 text-sm"
      >
        <option value="" disabled>
          Choose a category...
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {selected && selected.formSchema.length > 0 && (
        <div className="space-y-3 border-t border-ff-border pt-2">
          {selected.formSchema.map((field) => (
            <DynamicField
              key={field.id}
              field={field}
              value={value.metadata[field.id]}
              onChange={(v) => onChange({ ...value, metadata: { ...value.metadata, [field.id]: v } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
