import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "./prisma";

// Who's signed in on this browser, if anyone, read from the session cookie
// only. Not getCurrentUser(): the public share page sits outside
// middleware.ts, so an expired session would make Supabase try to refresh
// its cookie from a page, which Next.js forbids (it threw and made the
// share page take seconds to load). Writes are no-ops here, and the id only
// decides whether to skip counting an open, never what anyone can see.
async function signedInUserId(): Promise<string | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get: (name: string) => cookieStore.get(name)?.value,
      set: () => {},
      remove: () => {},
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  // The cookie alone is unverified (anyone can write one naming any user),
  // so the token is checked with Supabase Auth before an open is credited
  // to a colleague by name.
  const { data: verified } = await supabase.auth.getUser(token);
  return verified.user?.id ?? null;
}

// Silent open/download tracking for share links (ShareLinkActivity), shown
// to the sharer on My Work > Shared links. Server side only: the shared page
// renders exactly the same whether or not this records anything, and a
// failure here (e.g. the table not migrated yet) never reaches the person
// who opened the link.

// Chat apps and mail scanners fetch a link to build its preview the moment
// it's pasted, which would read as "opened" before anyone clicked it.
const BOT_UA = /bot|crawler|spider|preview|slurp|facebookexternalhit|embedly|whatsapp|slack|discord|telegram|googleimageproxy|skypeuripreview|microsoft office|outlook|curl|wget|python-requests|headless/i;

export async function recordShareActivity(share: { id: string; createdById: string }, type: "open" | "download") {
  try {
    const ua = headers().get("user-agent") ?? "";
    if (!ua || BOT_UA.test(ua)) return;
    const visitorId = visitorFor(ua);
    const viewerId = await signedInUserId().catch(() => null);
    // The person who made this link opening it doesn't count. Anything this
    // browser recorded before they signed in was theirs too, so it goes.
    if (viewerId === share.createdById) {
      await prisma.shareLinkActivity.deleteMany({ where: { shareLinkId: share.id, visitorId } });
      return;
    }
    // Same visitor again (a reload, a second visit): one row, newer lastAt.
    // A colleague signed in to the vault is remembered by name.
    await prisma.shareLinkActivity.upsert({
      where: { shareLinkId_visitorId_type: { shareLinkId: share.id, visitorId, type } },
      create: { shareLinkId: share.id, visitorId, type, userId: viewerId },
      update: { lastAt: new Date(), count: { increment: 1 }, ...(viewerId ? { userId: viewerId } : {}) },
    });
  } catch (err) {
    console.error("Could not record share link activity:", err);
  }
}

// The anonymous browser id middleware.ts gives every share page visitor
// (header on the first visit, cookie after). Without it (cookies blocked),
// a hash of network address and browser, so reloads still count once.
function visitorFor(ua: string): string {
  const h = headers();
  const id = h.get("x-share-visitor") ?? cookies().get("ff_sv")?.value;
  if (id) return id;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return `h:${createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32)}`;
}

export type ShareActivitySummary = {
  // Distinct visitors, not page loads.
  opens: number;
  downloads: number;
  firstOpenedAt: Date | null;
  lastOpenedAt: Date | null;
  // Colleagues signed in to the vault who opened it, by name.
  colleagues: string[];
};

/** Opens and downloads per share link id. Empty when there's nothing yet,
 * or when the table isn't migrated yet, so My Work still renders. */
export async function shareActivityFor(shareLinkIds: string[]): Promise<Map<string, ShareActivitySummary>> {
  const result = new Map<string, ShareActivitySummary>();
  if (shareLinkIds.length === 0) return result;
  try {
    const rows = await prisma.shareLinkActivity.groupBy({
      by: ["shareLinkId", "type"],
      where: { shareLinkId: { in: shareLinkIds } },
      _count: { _all: true },
      _min: { firstAt: true },
      _max: { lastAt: true },
    });
    for (const r of rows) {
      const s = result.get(r.shareLinkId) ?? { opens: 0, downloads: 0, firstOpenedAt: null, lastOpenedAt: null, colleagues: [] };
      if (r.type === "download") s.downloads += r._count._all;
      else {
        s.opens += r._count._all;
        s.firstOpenedAt = r._min.firstAt;
        s.lastOpenedAt = r._max.lastAt;
      }
      result.set(r.shareLinkId, s);
    }
    const named = await prisma.shareLinkActivity.findMany({
      where: { shareLinkId: { in: shareLinkIds }, type: "open", userId: { not: null } },
      select: { shareLinkId: true, user: { select: { name: true } } },
    });
    for (const n of named) {
      const s = result.get(n.shareLinkId);
      if (s && n.user && !s.colleagues.includes(n.user.name)) s.colleagues.push(n.user.name);
    }
  } catch (err) {
    console.error("Could not load share link activity:", err);
  }
  return result;
}
