"use client";

import { useState } from "react";
import { Info } from "lucide-react";

// Small "i" icon that reveals longer explanatory text on click, instead of
// that text sitting inline as its own paragraph — keeps the primary label
// short and lets anyone who wants the detail ask for it.
export default function InfoTooltip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        className="flex h-4 w-4 items-center justify-center rounded-full text-ff-textMuted transition-colors hover:text-ff-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute top-full z-50 mt-1.5 w-64 rounded-ff border border-ff-border bg-white p-2.5 text-xs font-normal leading-relaxed text-ff-textMuted shadow-ff-lg ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {text}
          </div>
        </>
      )}
    </span>
  );
}
