import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { WORKSPACE_ICON_KEYS } from "@/lib/workspaceIcons";
import { prisma } from "@/lib/prisma";

// GET /api/admin/workspace-apps — superadmin only, for the manager UI
// itself (app/admin/workspace-apps). The public launcher (app/page.tsx)
// reads this table directly via Prisma at render time instead, since it's
// unauthenticated and has no reason to go through an API route.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageWorkspaceApps");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const apps = await prisma.workspaceApp.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json(apps);
}

// POST /api/admin/workspace-apps — superadmin adds a new launcher tile.
// href is optional: left blank, the tile renders as "Coming Soon" instead
// of a link (see app/page.tsx's AppTile) until it's filled in later.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageWorkspaceApps");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { name, category, description, href, icon } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (typeof category !== "string" || !category.trim()) {
    return NextResponse.json({ error: "Category is required." }, { status: 400 });
  }
  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "Description is required." }, { status: 400 });
  }
  if (href !== undefined && href !== null && (typeof href !== "string" || (href.trim() && !/^https?:\/\//i.test(href.trim())))) {
    return NextResponse.json({ error: "Link must be a full URL starting with http:// or https://, or left blank." }, { status: 400 });
  }
  if (typeof icon !== "string" || !WORKSPACE_ICON_KEYS.includes(icon)) {
    return NextResponse.json({ error: "Invalid icon." }, { status: 400 });
  }

  // New tiles go to the end of the grid by default — one more than the
  // current highest sortOrder, so they don't jump ahead of existing ones.
  const last = await prisma.workspaceApp.findFirst({ orderBy: { sortOrder: "desc" } });

  const app = await prisma.workspaceApp.create({
    data: {
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      href: typeof href === "string" && href.trim() ? href.trim() : null,
      icon,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json(app, { status: 201 });
}
