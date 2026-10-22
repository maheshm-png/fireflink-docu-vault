import { redirect } from "next/navigation";

// Team Space was merged into Home as its "My teams" view (2026-10-12). Old
// links and bookmarks land there, keeping the team chip and search.
export default async function TeamSpaceRedirect(
  props: { searchParams: Promise<{ team?: string; q?: string; view?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams({ space: "teams" });
  for (const key of ["team", "q", "view"] as const) {
    const v = searchParams[key];
    if (typeof v === "string" && v) params.set(key, v);
  }
  redirect(`/dashboard?${params.toString()}`);
}
