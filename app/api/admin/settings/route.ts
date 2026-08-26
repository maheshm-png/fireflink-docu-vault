import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase";
import { assertCan } from "@/lib/rbac";
import { getAppSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageSettings");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }
  return NextResponse.json(await getAppSettings());
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertCan(user.role, "manageSettings");
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
  }

  const { deletedDocRetentionDays, oldVersionRetentionDays } = await req.json();
  if (
    !Number.isInteger(deletedDocRetentionDays) || deletedDocRetentionDays < 1 ||
    !Number.isInteger(oldVersionRetentionDays) || oldVersionRetentionDays < 1
  ) {
    return NextResponse.json({ error: "Retention windows must be whole numbers of at least 1 day" }, { status: 400 });
  }

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: { deletedDocRetentionDays, oldVersionRetentionDays },
    create: { id: "singleton", deletedDocRetentionDays, oldVersionRetentionDays },
  });

  return NextResponse.json(settings);
}
