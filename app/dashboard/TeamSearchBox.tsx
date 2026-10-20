"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

// Search box for Home > My teams. Keeps the team, folder and view in the
// URL and only swaps ?q=, which TeamSpaceView matches against each team
// document's title, tags, category, uploader and file text.
export default function TeamSearchBox({ initialQuery, placeholder }: { initialQuery: string; placeholder: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  function go(q: string) {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    next.delete("page");
    router.push(`/dashboard?${next.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
      className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-ff border border-ff-border bg-white px-3 py-2 focus-within:border-ff-accent"
      role="search"
    >
      <Search className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            go("");
          }}
          aria-label="Clear search"
          className="rounded p-0.5 text-ff-textMuted hover:text-ff-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </form>
  );
}
