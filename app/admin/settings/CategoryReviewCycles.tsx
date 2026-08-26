"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BrandedLoader from "@/components/BrandedLoader";

type Category = { id: string; name: string; reviewCycleDays: number | null };

export default function CategoryReviewCycles({ categories }: { categories: Category[] }) {
  const router = useRouter();
  // null means "no review cycle" — documents uploaded into that category
  // default to permanent instead of ever being flagged for re-review.
  const [values, setValues] = useState<Record<string, number | null>>(
    Object.fromEntries(categories.map((c) => [c.id, c.reviewCycleDays]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function save(categoryId: string) {
    setSavingId(categoryId);
    setSavedId(null);
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewCycleDays: values[categoryId] }),
    });
    setSavingId(null);
    if (res.ok) {
      setSavedId(categoryId);
      router.refresh();
    }
  }

  return (
    <div className="rounded-ff border border-ff-border bg-white p-4 shadow-ff">
      <h2 className="mb-1 text-base font-bold text-ff-text">Review cycles</h2>
      <p className="mb-4 text-xs text-ff-textMuted">
        How many days a published document in each category stays valid before it&apos;s flagged for re-review.
      </p>
      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-ff border border-ff-border p-2.5">
            <span className="flex-1 text-sm text-ff-text">{c.name}</span>
            <input
              type="number"
              min={1}
              disabled={values[c.id] === null}
              value={values[c.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [c.id]: parseInt(e.target.value, 10) || 1 }))}
              className="w-20 rounded-ff border border-ff-border px-2 py-1 text-sm disabled:bg-ff-lavender/40 disabled:text-ff-textMuted"
            />
            <span className="text-xs text-ff-textMuted">days</span>
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ff-textMuted">
              <input
                type="checkbox"
                checked={values[c.id] === null}
                onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.checked ? null : 90 }))}
              />
              None
            </label>
            <button
              onClick={() => save(c.id)}
              disabled={savingId !== null || values[c.id] === c.reviewCycleDays}
              className="flex items-center justify-center rounded-ff border border-ff-border px-3 py-1 text-xs text-ff-text transition-colors hover:bg-ff-lavender disabled:opacity-50"
            >
              {savingId === c.id ? <BrandedLoader size={12} /> : "Save"}
            </button>
            {savedId === c.id && savingId === null && <span className="text-xs text-ff-success">Saved</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
