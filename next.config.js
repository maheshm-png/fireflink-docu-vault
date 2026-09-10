/** @type {import('next').NextConfig} */
const nextConfig = {
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
