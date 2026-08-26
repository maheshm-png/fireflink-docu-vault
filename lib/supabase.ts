import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Role } from "./rbac";
import { prisma } from "./prisma";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use in Server Components / Route Handlers only.
 */
export function supabaseServer() {
  const cookieStore = cookies();
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

/**
 * Fetches the current authenticated user + their app role. Returns null if
 * not logged in. Every page starts with this call, so it's on the critical
 * path for every navigation — the identity check itself (auth.getUser())
 * has to stay a real network round-trip to Supabase Auth for security, but
 * the profile lookup right after it used to be a *second* round-trip
 * through Supabase's PostgREST layer. That's now a direct Prisma query
 * instead — same database, but through the app's already-open connection
 * pool (see lib/prisma.ts) rather than another HTTP+auth hop.
 *
 * Wrapped in React's cache() so if more than one Server Component in the
 * same request tree calls this (a page and a layout both needing the user,
 * say), the auth.getUser() network round-trip and the Prisma lookup happen
 * once per request, not once per caller.
 */
export const getCurrentUser = cache(async () => {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      reportsToId: true,
      designation: { select: { name: true } },
    },
  });

  if (!profile || !profile.isActive) return null;

  return { ...profile, role: profile.role as Role };
});
