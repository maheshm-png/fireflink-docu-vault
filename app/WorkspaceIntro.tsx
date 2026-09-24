"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

// Full-screen plum splash shown once on landing at "/" — same three-phase
// "in" -> "out" -> "done" pattern as the login page's own intro
// (app/login/page.tsx), reused here rather than reinvented, just plum
// instead of white and with a second beat (the "Welcome to..." line)
// after the logo. The real page (WorkspaceHeader + the app grid) is
// already mounted underneath the whole time — this is purely a fixed
// overlay on top of it, so there's no flash of unstyled content once it
// fades away, just the page that was already there.
export default function WorkspaceIntro() {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");

  useEffect(() => {
    // Logo entrance: 0.7s. Text reveal starts at 0.5s (see its own
    // animation-delay below), takes 1.1s, so it finishes at 1.6s. A short
    // hold, then the whole overlay fades out.
    const t1 = setTimeout(() => setPhase("out"), 1900);
    const t2 = setTimeout(() => setPhase("done"), 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-ff-plum-gradient ${
        phase === "out" ? "animate-intro-fade-out" : ""
      }`}
      aria-hidden
    >
      {/* Glow the logo sits inside of, not just on top of — same spotlight
          idea as WorkspaceHeader's own hero, reused here so the splash and
          the page it hands off to feel like one continuous piece rather
          than two different treatments. */}
      <div
        className="pointer-events-none absolute h-[480px] w-[480px] rounded-full opacity-70"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 65%)" }}
      />

      <div className="relative animate-workspace-intro-logo">
        {/* Same tight "glow behind the shape" halo now used on the app
            tiles' own icon badges (app/page.tsx) — a second, closer-fitting
            glow around the logo itself, layered with the big ambient
            spotlight above it, so the two pages read as one consistent
            glow language rather than the intro only having the broader,
            more diffuse effect. */}
        <span className="absolute inset-0 -z-10 scale-150 rounded-full bg-white opacity-30 blur-2xl" aria-hidden />
        <Logo
          variant="white"
          width={200}
          height={49}
          priority
          className="relative drop-shadow-[0_0_36px_rgba(255,255,255,0.45)]"
        />
      </div>

      <div
        className="relative mt-7 overflow-hidden text-center animate-intro-logo-in"
        style={{ animationDelay: "0.5s" }}
      >
        <p className="text-lg font-semibold text-white/90 sm:text-xl">Welcome to FireFlink Suite</p>
        <p className="mt-1 text-2xl font-extrabold uppercase tracking-wide text-white sm:text-3xl">Workspace</p>
      </div>
    </div>
  );
}
