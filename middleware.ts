import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Anonymous id for whoever opens a share link (lib/shareTracking.ts), so
// reloads by the same browser count as one open. Random, holds nothing
// about the person, never shown on the page.
const SHARE_VISITOR_COOKIE = "ff_sv";

export async function middleware(req: NextRequest) {
  // Public share pages: just make sure the visitor id exists, no auth. Also
  // forwarded as a header, since the page can't see a cookie set on this
  // same response.
  if (req.nextUrl.pathname.startsWith("/share/")) {
    const existing = req.cookies.get(SHARE_VISITOR_COOKIE)?.value;
    const visitorId = existing ?? crypto.randomUUID();
    const headers = new Headers(req.headers);
    headers.set("x-share-visitor", visitorId);
    const shareRes = NextResponse.next({ request: { headers } });
    if (!existing) {
      shareRes.cookies.set(SHARE_VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return shareRes;
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => res.cookies.set(name, value, options),
        remove: (name: string, options: CookieOptions) => res.cookies.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  const isProtected =
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/admin");

  if (isProtected && !session) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Set (app_metadata, so only the server can) whenever an admin chose the
  // password or an invite link signed them in without one. Until they pick
  // their own on /accept-invite, nothing else in the app is reachable.
  // /api/auth/* stays open so that page can save the new password and
  // sign-out keeps working.
  if (session?.user.app_metadata?.must_change_password === true) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      if (req.nextUrl.pathname.startsWith("/api/auth/")) return res;
      return NextResponse.json({ error: "Set your password first." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/accept-invite", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/:path*", "/share/:path*"],
};
