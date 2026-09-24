// App-wide closing line — copyright + attribution, same copy the login
// page's own footer already uses (app/login/page.tsx), reused here instead
// of restated so the two never drift apart. Deliberately quiet (one small,
// heavily muted line, no border/card chrome) since this is boilerplate
// nobody comes to a page to read, not content competing with it.
//
// Sits directly after the page's own content in normal flow rather than
// pinned to the bottom of the viewport — pinning it (via mt-auto on a flex-
// column <main>) left a large dead gap on every short page (Home, with just
// a couple of category tiles, was the worst case), which read as more
// broken than the footer simply not always being flush against the bottom.
export default function Footer() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-6 py-4 text-center">
      <p className="text-xs text-ff-textMuted/50">
        Copyright © FireFlink Pvt Ltd. All Rights Reserved · Contributed by the Demo &amp; Presales Team
      </p>
    </footer>
  );
}
