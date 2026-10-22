"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

// Small "i" icon that reveals longer explanatory text on click, instead of
// that text sitting inline as its own paragraph — keeps the primary label
// short and lets anyone who wants the detail ask for it. Renders only
// spans so it is valid inside headings, paragraphs and labels.
//
// Closes on any click outside it, or Escape. This listens on the document
// rather than laying an invisible full-screen layer behind the bubble: such
// a layer is position:fixed, and inside a card with a transform, filter or
// backdrop blur it only covers that card, so clicks elsewhere on the page
// never reached it and the bubble stayed open.
export default function InfoTooltip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => {
          // Inside a <label> or a clickable row, the click is only for the icon.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More info"
        aria-expanded={open}
        className="flex h-4 w-4 items-center justify-center rounded-full text-ff-textMuted transition-colors hover:text-ff-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-50 mt-1.5 block w-64 rounded-ff border border-ff-border bg-white p-2.5 text-xs font-normal leading-relaxed text-ff-textMuted shadow-ff-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
