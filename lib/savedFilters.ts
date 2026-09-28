import { prisma } from "./prisma";
import type { SavedFilterChip } from "@/components/DocumentFilters";

/** The user's own saved filters for one listing section, oldest first (the order they were created in). */
export async function getSavedFilters(userId: string, section: string): Promise<SavedFilterChip[]> {
  const rows = await prisma.savedFilter.findMany({
    where: { userId, section },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, params: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    params: (Array.isArray(r.params) ? r.params : []).filter(
      (p): p is [string, string] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string"
    ),
  }));
}
