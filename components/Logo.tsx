import Image from "next/image";

/**
 * Our logo assets (public/logo-*.png) are the colored purple/orange mark on
 * a transparent background — there's no separate white/monochrome variant.
 * `variant="white"` force-converts it to a solid white silhouette via CSS
 * (brightness-0 turns every opaque pixel black, invert flips that to white),
 * matching how the FireFlink brand renders its logo on dark surfaces
 * (us-app.fireflink.com's sign-in screen) without needing a new asset.
 */
export default function Logo({
  variant = "color",
  icon = false,
  width,
  height,
  className = "",
  priority = false,
}: {
  variant?: "color" | "white";
  icon?: boolean;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={icon ? "/logo-icon.png" : "/logo-full.png"}
      alt="FireFlink"
      width={width}
      height={height}
      priority={priority}
      className={`${variant === "white" ? "brightness-0 invert" : ""} ${className}`}
    />
  );
}
