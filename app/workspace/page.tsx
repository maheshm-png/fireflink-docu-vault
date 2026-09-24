import type { Metadata } from "next";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import Footer from "@/components/Footer";
import WorkspaceHeader from "./WorkspaceHeader";
import WorkspaceIntro from "./WorkspaceIntro";
import { WORKSPACE_ICONS, DEFAULT_WORKSPACE_ICON } from "@/lib/workspaceIcons";
import { prisma } from "@/lib/prisma";

// Overrides app/layout.tsx's root "FireFlink Docu Vault" title just for this
// route — this page is the umbrella hub above Docu Vault, not Docu Vault
// itself, so its own browser tab should read as the hub, not the one app
// that happens to also live in this same codebase.
export const metadata: Metadata = {
  title: "FireFlink Workspace",
};

// No cookies/headers read anywhere on this page (it's public, pre-login) —
// Next would otherwise statically prerender it at BUILD time, baking in
// whatever WorkspaceApp rows existed then and never picking up an edit made
// later through app/admin/workspace-apps without a full rebuild/redeploy,
// which defeats the entire point of that admin UI.
export const dynamic = "force-dynamic";

// Cycled by tile index rather than tied to a specific app — same four
// semantic colors already used across the app (tailwind.config.ts) for
// status pills/badges, reused here (gradient for the icon badge and top
// accent stripe, solid for the category label + dot) purely so a row of
// tiles reads as visually distinct without introducing colors outside the
// existing FF palette.
const TILE_THEMES = [
  { gradient: "bg-ff-accent-gradient", text: "text-ff-accent", dot: "bg-ff-accent" },
  { gradient: "bg-ff-success-gradient", text: "text-ff-success", dot: "bg-ff-success" },
  { gradient: "bg-ff-warning-gradient", text: "text-ff-warning", dot: "bg-ff-warning" },
  { gradient: "bg-ff-danger-gradient", text: "text-ff-danger", dot: "bg-ff-danger" },
];

// Public, unauthenticated page at /workspace — the FireFlink Workspace hub,
// one level above any single app's own sign-in (app/login/page.tsx is Docu
// Vault's; the site root redirects there, not here).
// The app list itself is superadmin-managed data (app/admin/workspace-apps,
// lib/rbac.ts's manageWorkspaceApps permission), not hardcoded here — every
// live app is a separate deployment on its own host, so links always open
// in a new tab; this hub is a launcher, not a frame around the apps it
// points to.
export default async function WorkspaceHomePage() {
  const apps = await prisma.workspaceApp.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

  return (
    // Same flat #FBF8FA every dashboard/admin page in this app already uses
    // behind its own white cards (see e.g. app/dashboard/home/page.tsx) —
    // bg-ff-surface-gradient's top stop is pure #FFFFFF, identical to the
    // cards' own bg-white fill, so with only a soft border/shadow the cards
    // had nothing to contrast against and read as barely-there.
    <div className="relative min-h-screen bg-[#FBF8FA]">
      <WorkspaceIntro />
      {/* Barely-there dot texture across the whole body — fixed, not part
          of document flow, so it reads as one continuous surface instead of
          visibly repeating/seaming at section boundaries while scrolling. */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #29102D 1px, transparent 0)", backgroundSize: "26px 26px" }}
        aria-hidden
      />

      <div className="relative z-10">
        <WorkspaceHeader appCount={apps.length} />

        <main className="mx-auto max-w-6xl px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-ff-textMuted">
              <LayoutGrid className="h-4 w-4" aria-hidden />
              Apps
            </h2>
            <span className="text-xs text-ff-textMuted">{apps.length} apps</span>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app, i) => (
              <AppTile key={app.id} app={app} theme={TILE_THEMES[i % TILE_THEMES.length]} />
            ))}
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function AppTile({
  app,
  theme,
}: {
  app: { name: string; category: string; description: string; href: string | null; icon: string };
  theme: { gradient: string; text: string; dot: string };
}) {
  const Icon = WORKSPACE_ICONS[app.icon] ?? WORKSPACE_ICONS[DEFAULT_WORKSPACE_ICON];
  const comingSoon = !app.href;

  const content = (
    <>
      {/* Colored top edge — the same quick-scan "which product family is
          this" cue a row of tiles otherwise only carries through the icon
          badge alone. Muted/flat for a Coming Soon tile, matching every
          other "not live yet" treatment on it. */}
      <span className={`absolute inset-x-0 top-0 h-1.5 ${comingSoon ? "bg-ff-textMuted/25" : theme.gradient}`} aria-hidden />

      <div className="flex items-start justify-between gap-2">
        <span className="relative shrink-0">
          {/* Soft colored glow behind the icon badge, tinted to the tile's
              own theme — the icon reads as lit from within rather than just
              sitting on a flat colored square, same "glow" language as the
              header's own spotlight and the login page's PlumWatermark. None
              for Coming Soon, matching every other "not live yet" muting. */}
          {!comingSoon && (
            <span className={`absolute inset-0 -z-10 scale-125 rounded-2xl opacity-50 blur-lg ${theme.gradient}`} aria-hidden />
          )}
          <span
            className={`relative flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_-8px_rgba(58,29,66,0.5)] ${
              comingSoon ? "bg-ff-textMuted/35" : theme.gradient
            }`}
          >
            <Icon className="h-7 w-7" aria-hidden />
          </span>
        </span>
        {comingSoon ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ff-lavender px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ff-textMuted">
            <span className="h-1.5 w-1.5 rounded-full bg-ff-textMuted/50" />
            Coming Soon
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-ff-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ff-success">
            <span className="h-1.5 w-1.5 rounded-full bg-ff-success animate-pulse" />
            Live
          </span>
        )}
      </div>

      <h3 className="mt-4 flex items-center gap-1 text-base font-bold text-ff-text">
        {app.name}
        {!comingSoon && (
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ff-textMuted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ff-accent" aria-hidden />
        )}
      </h3>
      <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${comingSoon ? "text-ff-textMuted" : theme.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${comingSoon ? "bg-ff-textMuted/40" : theme.dot}`} aria-hidden />
        {app.category}
      </div>
      <p className="mt-2.5 text-sm leading-snug text-ff-textMuted">{app.description}</p>
    </>
  );

  if (comingSoon) {
    return (
      <div className="relative flex cursor-default flex-col overflow-hidden rounded-ff border border-dashed border-ff-border bg-white/60 p-6 pt-7 opacity-80">
        {content}
      </div>
    );
  }

  return (
    <a
      href={app.href!}
      target="_blank"
      rel="noreferrer"
      // shadow-ff-lg at rest, not just on hover — the same resting-state
      // shadow the login page's own sign-in card uses (tailwind.config.ts),
      // proven to read clearly against this exact near-white background;
      // the earlier hand-rolled shadow was still too soft even after
      // strengthening it once already. Hover goes stronger still, and lifts.
      className="group relative flex flex-col overflow-hidden rounded-ff border border-ff-border bg-white p-6 pt-7 shadow-ff-lg transition-all hover:-translate-y-1.5 hover:border-ff-accent/40 hover:shadow-[0_32px_60px_-16px_rgba(41,16,45,0.45)]"
    >
      {content}
    </a>
  );
}
