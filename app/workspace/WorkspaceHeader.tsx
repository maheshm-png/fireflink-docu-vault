"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import Logo from "@/components/Logo";
import PlumWatermark from "@/components/PlumWatermark";

// Sticky (not just scrolled-past-and-gone) so the brand bar is always on
// screen, but the full premium hero version only makes sense at the very
// top of the page — past a short scroll it condenses into a single compact
// row (logo + "Workspace" + tagline, all inline) instead of continuing to
// eat screen space (and, worse, cover the top of the app grid) once
// scrolled.
//
// Driven by an IntersectionObserver on a fixed sentinel rather than a raw
// `window.scrollY` threshold — the header's OWN height changes between the
// two states (tall hero vs. thin bar), so a scrollY-based check fights
// itself: condensing shrinks the header, which shrinks total page height,
// which changes what "scrolled past 72px" even means, and could bounce the
// state back and forth without ever settling. The sentinel sits at a fixed
// spot in the page that never moves regardless of which state the header is
// currently rendering, so there's nothing for the header's own size changes
// to feed back into.
export default function WorkspaceHeader({ appCount }: { appCount: number }) {
  const [condensed, setCondensed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setCondensed(!entry.isIntersecting), {
      rootMargin: "-72px 0px 0px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative">
      {/* Fixed 72px down from the true top of the page, independent of the
          header's own current height — see this component's own comment
          above for why that independence is the whole point. */}
      <div ref={sentinelRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden />

      <header
        className={`sticky top-0 z-20 overflow-hidden bg-ff-plum-gradient text-white transition-[padding] duration-300 ${
          condensed ? "px-6 py-3.5" : "relative px-6 py-20 text-center sm:py-24"
        }`}
      >
        {!condensed && (
          <>
            <DecorativePattern />
            {/* Soft radial spotlight directly behind the logo/title — the
                thing that actually reads as "premium" rather than just a
                flat gradient fill with text on it: a glow the content sits
                inside of, not on top of. */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 65%)" }}
              aria-hidden
            />
            <PlumWatermark className="absolute -bottom-24 -left-20 z-0 w-[360px] opacity-90" />
            <PlumWatermark className="absolute -top-16 -right-16 z-0 w-[260px] opacity-70" />
          </>
        )}

        {/* A crisp accent line at the seam, not an attempted blend between
            two colors — the same gradient-strip pattern already used
            elsewhere at a transition point (app/share/[token]/page.tsx's
            preview-frame opener, this same header's own info-card top edge
            elsewhere in the app), rather than a soft fade, which just read
            as a hazy gray smear no matter how it was tuned. A confident
            dividing line reads as designed on purpose; a bad gradient reads
            as a mistake. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[3px]"
          style={{ background: "linear-gradient(90deg, #8E2E7A 0%, #C77DB5 50%, #8E2E7A 100%)" }}
          aria-hidden
        />

        {condensed ? (
          <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-center gap-3">
            <Logo variant="white" width={120} height={29} priority />
            <span className="h-5 w-px shrink-0 bg-white/25" aria-hidden />
            <span className="shrink-0 text-base font-bold uppercase tracking-tight">Presales Team Assets</span>
            <span className="hidden truncate text-sm text-white/60 sm:inline">
              Everything our team contributes, in one place.
            </span>
          </div>
        ) : (
          <div className="relative z-10 mx-auto max-w-2xl">
            <Logo variant="white" width={190} height={46} priority className="mx-auto drop-shadow-[0_2px_16px_rgba(0,0,0,0.25)]" />

            {/* Premium "badge" pill — the small floating-glass detail that
                separates a hero from a plain colored banner. */}
            <span className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 text-white/70" aria-hidden />
              {appCount} {appCount === 1 ? "asset" : "assets"}, one place
            </span>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.2)] sm:text-5xl">
              <span className="uppercase">Presales Team Assets</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base text-white/70">
              Everything our team contributes, in one place.
            </p>
          </div>
        )}
      </header>
    </div>
  );
}

/** Same subtle circuit/dot + glow-orb texture as the login page's brand panel (app/login/page.tsx). */
function DecorativePattern() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1.5px 1.5px, rgba(255,255,255,0.25) 1.5px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-ff-accent/30 blur-3xl" />
      <div className="absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-ff-accentHover/20 blur-3xl" />
    </div>
  );
}
