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
};
module.exports = nextConfig;
