import { redirect } from "next/navigation";

// Team Space was merged into Home as its "My teams" view (2026-10-12). Old
// links and bookmarks land there, keeping the team chip and search.
export default function TeamSpaceRedirect({ searchParams }: { searchParams: { team?: string; q?: string; view?: string } }) {
  const params = new URLSearchParams({ space: "teams" });
  for (const key of ["team", "q", "view"] as const) {
    const v = searchParams[key];
    if (typeof v === "string" && v) params.set(key, v);
  }
  redirect(`/dashboard?${params.toString()}`);
}
