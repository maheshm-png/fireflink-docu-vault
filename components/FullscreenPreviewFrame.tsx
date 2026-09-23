"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/**
 * Adds a fullscreen toggle around whatever preview element it wraps (an
 * <iframe> or <video>) — used on the public share page, where (unlike the
 * authenticated DocumentPreview modal, which already maximizes itself)
 * there was previously no way to view the document any bigger than the
 * inline embed.
 *
 * This component owns ALL sizing, in both states — `heightClassName` sets
 * the normal (non-fullscreen) height, and the child is always rendered at
 * h-full/w-full of whatever this wrapper currently is. The child itself
 * must NOT carry its own fixed height (e.g. h-[80vh]) — that stays fixed
 * regardless of the wrapper going fullscreen, which is exactly why an
 * earlier version of this didn't actually fill the screen: the outer box
 * grew to h-screen but the iframe/video inside stayed pinned at 80vh.
 *
 * `remountOnToggle` forces the child to fully unmount/remount (via a
 * changing `key`) whenever fullscreen is entered or exited — needed for a
 * PDF iframe, whose browser-native viewer keeps whatever zoom level it had
 * even after its container resizes (exiting fullscreen otherwise leaves it
 * zoomed for the old, bigger size). A fresh load re-reads the `zoom=`
 * fragment on the iframe's own src (see its callers) and fits correctly at
 * the new size. Left off (the default) for anything where remounting would
 * be actively harmful, like a <video> — that would restart playback and
 * lose the current position on every toggle.
 */
export default function FullscreenPreviewFrame({
  children,
  heightClassName = "h-[80vh]",
  remountOnToggle = false,
  watermark,
}: {
  children: React.ReactNode;
  heightClassName?: string;
  remountOnToggle?: boolean;
  // Rendered as an overlay INSIDE this component's own ref'd wrapper
  // (components/ViewOnlyWatermark.tsx, from the share page) rather than by
  // the caller placing it alongside this component — fullscreen only
  // keeps descendants of the requestFullscreen() target visible, so a
  // watermark sitting outside this wrapper would simply vanish the moment
  // someone opens fullscreen, defeating the entire point of it.
  watermark?: React.ReactNode;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggle() {
    if (!ref.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else ref.current.requestFullscreen().catch(() => {});
  }

  return (
    <div ref={ref} className={`relative w-full ${fullscreen ? "h-screen bg-black" : heightClassName}`}>
      <button
        type="button"
        onClick={toggle}
        title={fullscreen ? "Exit full screen" : "Full screen"}
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        className="absolute right-2 top-2 z-10 rounded bg-white/90 p-1.5 text-ff-textMuted shadow transition-colors hover:bg-white hover:text-ff-text"
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      <div className="h-full w-full" key={remountOnToggle ? String(fullscreen) : undefined}>
        {children}
      </div>
      {watermark}
    </div>
  );
}
