import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
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
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/:path*"],
};
