import { redirect } from "next/navigation";

// Revoke was merged into Archive (2026-10-12): a document taken out of
// circulation is archived, and one being re-approved shows under My Work's
// "In review" filter. Old links and bookmarks land on Home.
export default function RevokedRedirect() {
  redirect("/dashboard");
}
