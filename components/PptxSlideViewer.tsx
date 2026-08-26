"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BrandedLoader from "./BrandedLoader";

type TextRun = { text: string; bold: boolean; italic: boolean; underline: boolean; sizePt?: number; color?: string };
type TextParagraph = { runs: TextRun[]; bullet: boolean; align?: "l" | "ctr" | "r" | "just" };
type SlideShape =
  | { type: "text"; x: number; y: number; w: number; h: number; paragraphs: TextParagraph[]; fill?: string }
  | { type: "image"; x: number; y: number; w: number; h: number; dataUrl: string };
type SlideDeck = { width: number; height: number; slides: { shapes: SlideShape[] }[] };

const ALIGN_MAP: Record<string, "left" | "center" | "right" | "justify"> = {
  l: "left",
  ctr: "center",
  r: "right",
  just: "justify",
};

// Default font size (points) for a run that doesn't carry an explicit size —
// common when it's inherited from the slide layout/master rather than set
// on the run itself, which this parser deliberately doesn't chase down.
const DEFAULT_RUN_PT = 18;

export default function PptxSlideViewer({ documentId, version }: { documentId: string; version?: number }) {
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const url = `/api/documents/${documentId}/pptx-preview${version ? `?version=${version}` : ""}`;
    setDeck(null);
    setError(null);
    setIndex(0);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setDeck)
      .catch(() => setError("Could not render slides for this presentation — try downloading it instead."));
  }, [documentId, version]);

  // Left/right arrow keys jump slides — safe to listen globally while this
  // viewer is mounted since it only ever appears inside the preview modal,
  // which has no text inputs to steal the keys from.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!deck || deck.slides.length === 0) return;
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(deck.slides.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deck]);

  if (error) {
    return <div className="p-10 text-center text-sm text-ff-textMuted">{error}</div>;
  }

  if (!deck) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <BrandedLoader size={32} label="Loading slides..." />
      </div>
    );
  }

  if (deck.slides.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-ff-textMuted">
        No renderable slides found in this file — try downloading instead.
      </div>
    );
  }

  const slide = deck.slides[index];
  // Font size is expressed as a fraction of the slide's own width (in
  // points) and rendered in `cqw` (1% of the slide box's own inline size) —
  // that keeps every run's size correctly proportioned to the actual slide
  // regardless of how big the preview box is drawn on screen, the same way
  // shape x/y/w/h are already expressed as percentages of deck.width/height.
  const slideWidthPt = deck.width / 12700;
  const fontSizeCqw = (sizePt: number | undefined) => ((sizePt ?? DEFAULT_RUN_PT) / slideWidthPt) * 100;

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-ff border border-ff-border bg-white shadow-ff"
        style={{ aspectRatio: `${deck.width} / ${deck.height}`, containerType: "inline-size" } as React.CSSProperties}
      >
        {slide.shapes.map((shape, i) => {
          const posStyle: React.CSSProperties = {
            position: "absolute",
            left: `${(shape.x / deck.width) * 100}%`,
            top: `${(shape.y / deck.height) * 100}%`,
            width: `${(shape.w / deck.width) * 100}%`,
            height: `${(shape.h / deck.height) * 100}%`,
          };
          if (shape.type === "image") {
            // eslint-disable-next-line @next/next/no-img-element -- data: URI, not a remote/optimizable src
            return <img key={i} src={shape.dataUrl} alt="" style={posStyle} className="object-contain" />;
          }
          return (
            <div
              key={i}
              style={{ ...posStyle, backgroundColor: shape.fill, padding: "1cqw" }}
              className="overflow-hidden text-ff-text"
            >
              {shape.paragraphs.map((para, pi) => (
                <p
                  key={pi}
                  style={{ textAlign: para.align ? ALIGN_MAP[para.align] : undefined, margin: 0 }}
                  className="whitespace-pre-wrap break-words leading-snug"
                >
                  {para.bullet && <span aria-hidden="true">&bull;&nbsp;</span>}
                  {para.runs.map((run, ri) => (
                    <span
                      key={ri}
                      style={{
                        fontWeight: run.bold ? 700 : 400,
                        fontStyle: run.italic ? "italic" : "normal",
                        textDecoration: run.underline ? "underline" : "none",
                        color: run.color,
                        fontSize: `${fontSizeCqw(run.sizePt)}cqw`,
                      }}
                    >
                      {run.text}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-sm text-ff-textMuted">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous slide"
          className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        Slide {index + 1} of {deck.slides.length}
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))}
          disabled={index === deck.slides.length - 1}
          aria-label="Next slide"
          className="rounded p-1.5 hover:bg-ff-lavender disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {deck.slides.length > 1 && (
        <div className="flex w-full max-w-3xl gap-1 overflow-x-auto pb-1" aria-label="Jump to slide">
          {deck.slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              className={`flex-none rounded px-2 py-1 text-xs transition-colors ${
                i === index ? "bg-ff-accent text-white" : "bg-ff-lavender/50 text-ff-textMuted hover:bg-ff-lavender"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <p className="max-w-md text-center text-xs text-ff-textMuted">
        Approximate rendering — text formatting and images shown in position; animations, theme colors, tables,
        charts, and complex effects aren&apos;t reproduced.
      </p>
    </div>
  );
}
