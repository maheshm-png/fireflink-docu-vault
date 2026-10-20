// Shared by the team folder API routes (app/api/teams/[id]/folders).
export const MAX_FOLDER_NAME = 60;

/** Trimmed, single-spaced folder name, or null when empty or too long. */
export function cleanFolderName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_FOLDER_NAME ? name : null;
}
