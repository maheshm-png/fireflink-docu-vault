import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { newDocumentsFor, parseNewDocsScope } from "@/lib/newDocuments";

// GET /api/notifications/new-documents — this user's unread "published"
// notifications, joined out to the documents' categories. Polled by
// components/NewDocumentsProvider.tsx (ticker entries + the NewBadge on
// Published Documents rows/tiles and Home category tiles) so those surfaces
// self-update once a document is actually opened (see the read-marking
// side-effect in app/dashboard/documents/[id]/page.tsx) without requiring a
// full page refresh — the same self-correcting-without-refresh behavior
// components/NotificationBell.tsx already has via its own poll loop.
// ?scope=team&team=<id> limits it to that team's documents; otherwise only
// documents for everyone (lib/newDocuments.ts).
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = parseNewDocsScope({ scope: req.nextUrl.searchParams.get("scope"), team: req.nextUrl.searchParams.get("team") });
  return NextResponse.json(await newDocumentsFor(user, scope));
}
