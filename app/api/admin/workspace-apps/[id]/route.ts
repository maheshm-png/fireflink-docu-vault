import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { WORKSPACE_ICON_KEYS } from "@/lib/workspaceIcons";
import { prisma } from "@/lib/prisma";

// PATCH /api/admin/workspace-apps/:id — superadmin edits a tile, including
// clearing `href` back to null (moving it back to "Coming Soon"). Every
// field is optional here (unlike POST's create) so a caller can update just
// sortOrder for a reorder without resending the whole row.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageWorkspaceApps");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const body = await req.json();
  const data: { name?: string; category?: string; description?: string; href?: string | null; icon?: string; sortOrder?: number } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    data.name = body.name.trim();
  }
  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !body.category.trim()) {
      return NextResponse.json({ error: "Category is required." }, { status: 400 });
    }
    data.category = body.category.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return NextResponse.json({ error: "Description is required." }, { status: 400 });
    }
    data.description = body.description.trim();
  }
  if (body.href !== undefined) {
    if (body.href !== null && (typeof body.href !== "string" || (body.href.trim() && !/^https?:\/\//i.test(body.href.trim())))) {
      return NextResponse.json({ error: "Link must be a full URL starting with http:// or https://, or left blank." }, { status: 400 });
    }
    data.href = typeof body.href === "string" && body.href.trim() ? body.href.trim() : null;
  }
  if (body.icon !== undefined) {
    if (typeof body.icon !== "string" || !WORKSPACE_ICON_KEYS.includes(body.icon)) {
      return NextResponse.json({ error: "Invalid icon." }, { status: 400 });
    }
    data.icon = body.icon;
  }
  if (body.sortOrder !== undefined) {
    if (typeof body.sortOrder !== "number" || !Number.isFinite(body.sortOrder)) {
      return NextResponse.json({ error: "Invalid order." }, { status: 400 });
    }
    data.sortOrder = body.sortOrder;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const app = await prisma.workspaceApp.update({ where: { id: params.id }, data });
  return NextResponse.json(app);
}

// DELETE /api/admin/workspace-apps/:id — superadmin removes a tile from the
// launcher entirely.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageWorkspaceApps");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  await prisma.workspaceApp.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
