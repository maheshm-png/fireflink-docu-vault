// Global categories are for documents for everyone only. Team documents
// don't use them: they're organised by the team's folders, and all sit in
// one built-in category (Category.isSystem) that's never offered or listed
// anywhere a category is picked. When a team document is opened to everyone,
// whoever does it must pick an existing global category (and fill in its
// required fields): resolveGlobalCategory checks that.
import { prisma } from "./prisma";
import { validateMetadataAgainstSchema, type CategoryFormField } from "./formSchema";

export const TEAM_CATEGORY_ID = "team-documents";

/** The built-in team category, created on first use if the migration
 * couldn't (it needs someone to record as its creator). */
export async function ensureTeamCategory(userId: string): Promise<string> {
  await prisma.category.upsert({
    where: { id: TEAM_CATEGORY_ID },
    update: {},
    create: {
      id: TEAM_CATEGORY_ID,
      name: "Team document",
      description: "Built-in category for team documents. Not shown in category lists.",
      reviewCycleDays: 90,
      formSchema: [],
      isSystem: true,
      createdById: userId,
    },
  });
  return TEAM_CATEGORY_ID;
}

/** Checks a global category picked for a document going to everyone, and
 * its detail fields. */
export async function resolveGlobalCategory(
  categoryId: unknown,
  metadata: unknown
): Promise<{ ok: true; categoryId: string; metadata: Record<string, unknown> } | { ok: false; error: string }> {
  if (typeof categoryId !== "string" || !categoryId) {
    return { ok: false, error: "Pick a category for everyone. Team documents don't have one yet." };
  }
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.isSystem) return { ok: false, error: "Pick one of the categories for everyone." };
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const schema = (category.formSchema as unknown as CategoryFormField[]) ?? [];
  const { valid, missing } = validateMetadataAgainstSchema(schema, meta);
  if (!valid) return { ok: false, error: `Fill in the ${category.name} details: ${missing.join(", ")}` };
  return { ok: true, categoryId: category.id, metadata: meta };
}
