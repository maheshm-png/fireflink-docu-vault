import { redirect } from "next/navigation";

// Home and Published Documents were merged: the Published page
// (app/dashboard/page.tsx) is now Home. Old links and bookmarks land there.
export default function HomeRedirect() {
  redirect("/dashboard");
}
