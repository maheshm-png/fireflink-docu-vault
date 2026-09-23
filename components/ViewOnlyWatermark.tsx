// Repeating, diagonal, semi-transparent text tiled across whatever
// position:relative container this sits inside (see its one caller,
// app/share/[token]/page.tsx, which wraps the preview area). Not a
// screenshot BLOCK — no browser API exists for a web page to detect or
// prevent an OS-level screenshot, screen recording, or a second device's
// camera pointed at the screen; anything claiming otherwise is either
// native-app-only (Android's FLAG_SECURE) or specific to DRM-protected
// video playback (Netflix), neither available to a page like this one.
// What this actually does — the same thing real document-sharing products
// (DocSend, etc.) rely on for the same reason — is make every screenshot
// traceable: it's baked into the rendered pixels themselves, so it survives
// a screenshot even though the underlying PDF/video bytes are never
// watermarked (see app/api/share/[token]/download/route.ts's own "clean
// original file" comment — that's a deliberate, separate decision for
// actual downloads, which only view_download shares expose at all).
//
// The share page itself is public and unauthenticated (anyone with the
// link), so there's no "who is viewing" identity to stamp — only the
// document and when this particular page render happened, which still
// lets a leaked screenshot be correlated against server access logs for
// that time window.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function ViewOnlyWatermark({ lines }: { lines: string[] }) {
  const safeLines = lines.map(escapeXml);
  const lineHeight = 18;
  const startY = 100 - ((safeLines.length - 1) * lineHeight) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220">
    <g transform="rotate(-28 180 110)" fill="rgba(41,19,48,0.08)" font-family="Arial, Helvetica, sans-serif" font-size="13" text-anchor="middle">
      ${safeLines.map((line, i) => `<text x="180" y="${startY + i * lineHeight}">${line}</text>`).join("")}
    </g>
  </svg>`;
  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ backgroundImage: `url("${dataUri}")`, backgroundRepeat: "repeat" }}
      aria-hidden
    />
  );
}
