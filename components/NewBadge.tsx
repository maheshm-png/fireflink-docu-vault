/** Small pulsing "NEW" tag — Published Documents rows/tiles for a document
 * (or a category tile holding one) that this viewer hasn't opened yet. Uses
 * the same underlying signal as the dashboard ticker's "New: ..." entries
 * (this user's unread "published" notifications, see app/dashboard/page.tsx
 * and app/dashboard/home/page.tsx) so both features agree on what counts as
 * new, and both clear the moment the document is actually opened. */
export default function NewBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex animate-new-pulse items-center rounded-full bg-ff-accent px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white ${className}`}
    >
      New
    </span>
  );
}
