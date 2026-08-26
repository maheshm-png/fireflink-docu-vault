"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function CategoryTabs({
  categories,
  basePath,
}: {
  categories: { id: string; name: string; count?: number }[];
  basePath: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("category") ?? "";

  function selectCategory(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("category", id);
    else next.delete("category");
    router.push(`${basePath}?${next.toString()}`);
    router.refresh();
  }

  return (
    <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
      <Tab label="All" isActive={active === ""} onClick={() => selectCategory("")} />
      {categories.map((c) => (
        <Tab
          key={c.id}
          label={c.name}
          count={c.count}
          isActive={active === c.id}
          onClick={() => selectCategory(c.id)}
        />
      ))}
    </div>
  );
}

function Tab({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-all ${
        isActive
          ? "bg-ff-accent-gradient font-medium text-white shadow-ff"
          : "text-ff-textMuted hover:bg-ff-lavender hover:text-ff-text"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className={`ml-1.5 text-xs ${isActive ? "text-white/75" : "text-ff-textMuted/70"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
