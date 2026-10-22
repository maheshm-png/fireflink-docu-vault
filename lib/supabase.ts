import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Role } from "./rbac";
import { prisma } from "./prisma";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use in Server Components / Route Handlers only.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => cookieStore.set(name, value, options),
        remove: (name: string, options: CookieOptions) => cookieStore.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );
}

type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  reportsToId: string | null;
  // Display string for the Navbar's profile badge: every team the user is
  // in, comma-joined. Null when they're in none.
  team: { name: string } | null;
  // Every team the user belongs to (UserTeam). Drives restricted-document
  // access, see lib/access.ts.
  teamIds: string[];
  // "Sees all teams" (User.seesAllTeams): they can view and comment on every
  // team's documents.
  seesAllTeams: boolean;
  // Leadership view of selected teams only (UserViewTeam).
  viewTeamIds: string[];
  // The one Global approver, picked by a superadmin in Settings.
  isGlobalApprover: boolean;
  // The user's role in each of their teams (UserTeam.role), keyed by team id.
  teamRoles: Record<string, "member" | "contributor" | "manager">;
  reportsTo: { name: string } | null;
} | null;

// Short-lived cross-request cache for getCurrentUser()'s result, keyed by
// the session's access token — see that function's own comment for why
// this exists. Module-scope Map survives across requests within this one
// long-running Node process (this app isn't deployed serverless, so
// there's exactly one of these, not one per invocation); a multi-instance
// deployment would just get a lower hit rate per instance, never stale
// data past AUTH_CACHE_TTL_MS.
const userCache = new Map<string, { user: CurrentUser; expiresAt: number }>();
const AUTH_CACHE_TTL_MS = 10_000;

/**
 * Fetches the current authenticated user + their app role. Returns null if
 * not logged in. Every page AND every API route starts with this call, so
 * it's on the critical path for every navigation and every poll (the
 * notification bell alone hits this every 30s per signed-in user) — at
 * real user counts, a full auth.getUser() network round-trip to Supabase
 * Auth on every single one of those adds up to the dominant source of
 * latency across the whole app, worse than any single slow page.
 *
 * auth.getUser() itself still runs — this doesn't trust the cookie blindly,
 * which is the real security property getUser() (over the purely-local
 * getSession()) buys — but only once per distinct session per
 * AUTH_CACHE_TTL_MS window, not once per request. A revoked/deactivated
 * user's access dies within that same window rather than instantly; a 401
 * a few seconds late is a reasonable trade for cutting the Auth server's
 * request volume by roughly TTL/poll-interval. getSession() (fast, local
 * JWT decode, refreshing the token if needed) still runs on every call
 * regardless of cache state, just to read the access token as a cache key
 * and to catch an actually-expired/missing session immediately.
 *
 * Wrapped in React's cache() on top of the Map above so multiple Server
 * Components in the same request tree (a page and a layout both needing
 * the user, say) share one lookup per request, same as before.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await supabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const cacheKey = session.access_token;
  const cached = userCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let result: CurrentUser = null;
  if (user) {
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        seesAllTeams: true,
        viewTeams: { select: { teamId: true } },
        isGlobalApprover: true,
        reportsToId: true,
        teamMemberships: { select: { role: true, team: { select: { id: true, name: true } } } },
        reportsTo: { select: { name: true } },
      },
    });
    if (profile && profile.isActive) {
      const { teamMemberships, viewTeams, ...rest } = profile;
      const teams = teamMemberships.map((m) => m.team).sort((a, b) => a.name.localeCompare(b.name));
      result = {
        ...rest,
        role: profile.role as Role,
        // "Presales (Manager), BD (Member)": the role in each team, so the
        // profile menu shows both levels of access at a glance.
        team: teamMemberships.length
          ? {
              name: [...teamMemberships]
                .sort((a, b) => a.team.name.localeCompare(b.team.name))
                .map((m) => `${m.team.name} (${m.role.charAt(0).toUpperCase()}${m.role.slice(1)})`)
                .join(", "),
            }
          : null,
        teamIds: teams.map((t) => t.id),
        viewTeamIds: viewTeams.map((v) => v.teamId),
        teamRoles: Object.fromEntries(teamMemberships.map((m) => [m.team.id, m.role])),
      };
    }
  }

  // Evict anything else that's aged out while we're here, rather than
  // running a separate timer — the map only ever holds as many entries as
  // there are distinct active sessions within one TTL window, so this stays
  // cheap even at real user counts.
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (entry.expiresAt <= now) userCache.delete(key);
  }
  userCache.set(cacheKey, { user: result, expiresAt: now + AUTH_CACHE_TTL_MS });

  return result;
});
