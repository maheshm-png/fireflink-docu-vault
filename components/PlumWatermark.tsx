// Big, faint FireFlink icon mark for a plum-colored surface (the login
// panel today; any other bg-ff-plum-gradient band can drop this in too) —
// a quiet brand detail, not a foreground graphic, so the fill stays dim
// enough to never fight with text placed over it. The two <path>s are a
// traced outline of public/logo-icon.png (its "I" bar and its arrow are
// separate closed shapes, not one). Every so often (see
// .plum-watermark-trace in globals.css) a bright line runs once around
// each shape's own edge and slowly fades back out — rather than glowing
// continuously, which would read as a UI element rather than a quiet
// watermark. The parent must be `position: relative` and supply
// sizing/positioning via className.
export default function PlumWatermark({ className = "" }: { className?: string }) {
  const barPath =
    "M 78,0 L 45,12 L 26,28 L 9,57 L 0,94 L 3,607 L 9,674 L 26,712 L 58,737 L 99,745 L 136,737 L 143,726 L 143,139 L 257,75 L 146,14 L 108,1 Z";
  const arrowPath =
    "M 384,143 L 371,145 L 274,215 L 272,346 L 389,276 L 511,347 L 263,488 L 261,663 L 627,446 L 662,412 L 676,380 L 671,332 L 637,288 Z";

  return (
    <svg
      viewBox="0 0 678 746"
      aria-hidden
      className={`pointer-events-none select-none overflow-visible ${className}`}
    >
      <defs>
        <filter id="plumWatermarkGlow" x="-75%" y="-75%" width="250%" height="250%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Still, dim base — this is the part that's always visible. */}
      <g fill="white" opacity="0.07">
        <path d={barPath} />
        <path d={arrowPath} />
      </g>

      {/* Traveling light that laps each shape's outline once per cycle. */}
      <g
        fill="none"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#plumWatermarkGlow)"
      >
        <path className="plum-watermark-trace" pathLength={100} d={barPath} />
        <path className="plum-watermark-trace" pathLength={100} d={arrowPath} />
      </g>
    </svg>
  );
}
