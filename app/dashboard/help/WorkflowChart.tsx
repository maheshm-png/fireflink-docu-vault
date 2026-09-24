"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CheckCircle2, XCircle, AlertTriangle, Circle, X } from "lucide-react";

export type FlowTone = "start" | "success" | "danger" | "warn" | "neutral";

// Soft tint for the card body — kept separate from the icon badge below,
// which uses a flat solid fill instead. Same two-layer pattern as the
// status pills elsewhere in the app (e.g. ReviewTrail.tsx's DOT_STYLE):
// a muted card so a whole row of them doesn't read as loud, with the
// actual status color concentrated in one small badge.
const TONE_CLASS: Record<FlowTone, string> = {
  start: "border-ff-accent/40 bg-ff-accent/5 text-ff-text",
  success: "border-ff-success/40 bg-ff-success/10 text-ff-text",
  danger: "border-ff-danger/40 bg-ff-danger/10 text-ff-text",
  warn: "border-ff-warning/40 bg-ff-warning/10 text-ff-text",
  neutral: "border-ff-border bg-ff-lavender/40 text-ff-text",
};

const TONE_BADGE: Record<FlowTone, string> = {
  start: "bg-ff-accent text-white",
  success: "bg-ff-success text-white",
  danger: "bg-ff-danger text-white",
  warn: "bg-ff-warning text-white",
  neutral: "bg-ff-textMuted/40 text-white",
};

const TONE_RING: Record<FlowTone, string> = {
  start: "ring-ff-accent/50",
  success: "ring-ff-success/50",
  danger: "ring-ff-danger/50",
  warn: "ring-ff-warning/50",
  neutral: "ring-ff-accent/50",
};

const TONE_ICON: Record<FlowTone, typeof Circle> = {
  start: Circle,
  success: CheckCircle2,
  danger: XCircle,
  warn: AlertTriangle,
  neutral: Circle,
};

export type Raci = {
  responsible?: string;
  accountable?: string;
  consulted?: string;
  informed?: string;
};

export type FlowNode = {
  label: string;
  note?: string;
  tone?: FlowTone;
  detail: string;
  raci: Raci;
};

const RACI_ROWS: { key: keyof Raci; label: string; hint: string }[] = [
  { key: "responsible", label: "Responsible", hint: "Does the work" },
  { key: "accountable", label: "Accountable", hint: "Owns the outcome" },
  { key: "consulted", label: "Consulted", hint: "Weighs in beforehand" },
  { key: "informed", label: "Informed", hint: "Told after the fact" },
];

// Every stage card across every chart shares this exact box — fixed width
// AND height, label/note forced to a single line each (`truncate`, never
// wrapped). Text length varies a lot between stages ("Published" vs.
// "Enter code + new password"), so letting cards size to content made
// neighboring boxes different widths/heights and the connecting arrows land
// at different vertical positions chart to chart. Fixing the box size and
// truncating instead keeps every chart's grid identical; the full text that
// doesn't fit is exactly what clicking the card reveals below.
const CARD_SIZE = "h-16 w-48";

// Client component (the page itself stays a server component) since each
// stage needs to be clickable and only one chart's worth of state — which
// node is expanded — needs to live anywhere. Selection state is local to
// each chart instance, not lifted up, so opening a stage in one chart never
// affects another.
export function WorkflowChart({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: FlowNode[][];
}) {
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Closes the open detail once this chart scrolls out of view entirely —
  // an expanded panel that's no longer on screen at all has nothing to stay
  // open for, and scrolling back down to a chart with a stale panel already
  // open (from before) reads as broken. Only watches while something's
  // actually open, not on every chart on the page all the time.
  useEffect(() => {
    if (!selected) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setSelected(null);
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [selected]);

  return (
    <div ref={containerRef} className="rounded-ff border border-ff-border bg-white p-5 shadow-ff">
      <h3 className="text-sm font-bold text-ff-text">{title}</h3>
      <p className="mb-1 text-xs text-ff-textMuted">{description}</p>
      <p className="mb-4 text-[11px] italic text-ff-textMuted/70">Click a stage for what it means and who&apos;s responsible.</p>

      {/* Single row, never wraps — a chart that doesn't fit scrolls
          horizontally instead of reflowing, which is what made the arrows
          jump around before. */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {steps.map((position, i) => (
          <div key={i} className="flex shrink-0 items-center gap-2">
            <div className="flex flex-col gap-1.5">
              {position.map((node) => {
                const tone = node.tone ?? "neutral";
                const Icon = TONE_ICON[tone];
                const isSelected = selected?.label === node.label;
                return (
                  <button
                    key={node.label}
                    type="button"
                    onClick={() => setSelected(isSelected ? null : node)}
                    className={`flex ${CARD_SIZE} shrink-0 items-center gap-2 rounded-ff border px-3 text-left transition hover:shadow-ff-md ${TONE_CLASS[tone]} ${
                      isSelected ? `shadow-ff-md ring-2 ring-offset-1 ${TONE_RING[tone]}` : ""
                    }`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONE_BADGE[tone]}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{node.label}</span>
                      {node.note && (
                        <span className="mt-0.5 block truncate text-[10.5px] font-normal text-ff-textMuted">{node.note}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />}
          </div>
        ))}
      </div>

      {selected && (
        <div className="mt-4 rounded-ff border border-ff-border bg-ff-lavender/20 p-4 animate-fade-in">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONE_BADGE[selected.tone ?? "neutral"]}`}>
                {(() => {
                  const Icon = TONE_ICON[selected.tone ?? "neutral"];
                  return <Icon className="h-3.5 w-3.5" aria-hidden />;
                })()}
              </span>
              <h4 className="text-sm font-bold text-ff-text">{selected.label}</h4>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="shrink-0 rounded p-1 text-ff-textMuted transition-colors hover:bg-white hover:text-ff-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mb-3 pl-8 text-sm text-ff-text">{selected.detail}</p>
          <div className="grid grid-cols-2 gap-2 pl-8 sm:grid-cols-4">
            {RACI_ROWS.map(({ key, label, hint }, idx) => {
              const value = selected.raci[key];
              if (!value) return null;
              return (
                <div
                  key={key}
                  className="animate-fade-in rounded-ff border border-ff-border bg-white p-2"
                  style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "backwards" }}
                >
                  <span className="inline-block rounded-full bg-ff-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ff-accent">
                    {label}
                  </span>
                  <div className="mt-1 text-[10px] text-ff-textMuted">{hint}</div>
                  <div className="mt-0.5 text-xs font-medium text-ff-text">{value}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
