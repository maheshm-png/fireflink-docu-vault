import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { isFilterKey } from "@/lib/docFilters";

const SECTION_PATTERN = /^(published:[\w-]+|review:(pending_review|rejected|archived)|revoked)$/;
const MAX_PER_SECTION = 30;

// POST /api/saved-filters: save the caller's current filter as a named
// filter for one listing section (see lib/docFilters.ts). Open to every
// role; each user only ever sees and manages their own. Saving under a
// name that already exists in that section replaces it.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const section = typeof body?.section === "string" ? body.section : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawParams: unknown = body?.params;

  if (!SECTION_PATTERN.test(section)) {
    return NextResponse.json({ error: "Unknown section." }, { status: 400 });
  }
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "Give the filter a name of up to 60 characters." }, { status: 400 });
  }
  if (!Array.isArray(rawParams)) {
    return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
  }
  const params = rawParams
    .filter(
      (p): p is [string, string] =>
        Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"
    )
    .filter(([k, v]) => isFilterKey(k) && v.trim() !== "" && v.length <= 200)
    .slice(0, 100);
  if (params.length === 0) {
    return NextResponse.json({ error: "Set at least one filter before saving." }, { status: 400 });
  }

  const existing = await prisma.savedFilter.findFirst({
    where: { userId: user.id, section, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    await prisma.savedFilter.update({ where: { id: existing.id }, data: { name, params } });
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const count = await prisma.savedFilter.count({ where: { userId: user.id, section } });
  if (count >= MAX_PER_SECTION) {
    return NextResponse.json(
      { error: `You can keep up to ${MAX_PER_SECTION} filters per section. Delete one to save another.` },
      { status: 400 }
    );
  }

  const created = await prisma.savedFilter.create({ data: { userId: user.id, section, name, params } });
  return NextResponse.json({ ok: true, id: created.id });
}
