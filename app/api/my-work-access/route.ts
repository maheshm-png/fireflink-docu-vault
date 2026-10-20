import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { hasMyWork } from "@/lib/access";

// GET /api/my-work-access — whether the signed-in person has anything on My
// Work. Always true unless their org role is "user"; then only when a team
// role (contributor/manager) gives them work there. Lets components/Navbar.tsx, which only knows the org role, show the
// My Work link to them too.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ myWork: hasMyWork(user) });
}
