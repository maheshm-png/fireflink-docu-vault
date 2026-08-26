import { prisma } from "./prisma";

/** Org-wide settings, stored as a single DB row so they're editable at
 * runtime from /admin/settings without a redeploy. Auto-creates the row
 * with defaults on first read, so callers never have to null-check it. */
export async function getAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}
