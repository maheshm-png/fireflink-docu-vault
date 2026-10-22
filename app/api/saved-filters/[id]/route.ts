import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

// DELETE /api/saved-filters/:id: remove one of the caller's own saved filters.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count } = await prisma.savedFilter.deleteMany({ where: { id: params.id, userId: user.id } });
  if (count === 0) return NextResponse.json({ error: "Filter not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
