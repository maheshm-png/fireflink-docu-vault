import { redirect } from "next/navigation";

// The Review Dashboard was merged into My Work (app/dashboard/my-work),
// which covers the same personal queue (uploads and reviews, by status) plus
// the documents waiting on you. Old links and bookmarks land on the matching
// view there.
export default function ReviewDashboardRedirect({ searchParams }: { searchParams: { status?: string } }) {
  const status = ["pending_review", "rejected", "archived"].includes(searchParams.status ?? "")
    ? searchParams.status!
    : "pending_review";
  redirect(`/dashboard/my-work?tab=all&status=${status}`);
}
