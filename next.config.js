// Sent on every response. Frames are limited to this site itself (the share
// page and preview dialogs iframe this app's own PDF routes), which stops
// other sites from framing the app to trick clicks. Referrer stays on this
// origin so share-link tokens in a URL never reach another site.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignored by browsers over plain http (local/LAN dev), enforced behind Caddy's https.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This folder is the app's root, even when a parent folder has its own
  // lockfile (Next 15 would otherwise guess the parent).
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  // The only next/image use is the small local logo files (components/Logo.tsx),
  // so the on-the-fly image optimizer isn't needed. Leaving it off also keeps
  // its endpoint (/_next/image), the subject of several Next.js 14 advisories,
  // out of reach.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The site root never renders anything: it goes straight to Docu Vault's sign-in.
  // Done here (a real 307) because app/loading.tsx makes a page-level redirect() a 200.
  async redirects() {
    return [{ source: "/", destination: "/login", permanent: false }];
  },
  experimental: {
    serverActions: { bodySizeLimit: "500mb" }, // allow large PPT/video uploads
    // Next.js 14's client-side Router Cache otherwise reuses a dynamic
    // page's RSC payload for 30s across client navigations — so clicking a
    // category tab or a filter dropdown (a searchParams-only navigation to
    // the same route) silently served stale, unfiltered data instead of
    // re-fetching. Every page here is already dynamic (getCurrentUser()
    // reads cookies()), so there's no static-render benefit being traded
    // away by disabling this.
    staleTimes: { dynamic: 0 },
  },
  // pdfjs-dist (components/PdfHighlightViewer.tsx) bundles a Node-only
  // fallback path that `require`s the native `canvas` package for
  // server-side PDF rendering — code that never actually runs in the
  // browser (we only ever load pdfjs-dist client-side), but webpack still
  // tries to statically resolve it when bundling and fails since it isn't
  // installed (nor wanted — it's a native binary with no purpose here).
  // Aliasing it to false tells webpack to stub it out instead.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};
module.exports = nextConfig;
