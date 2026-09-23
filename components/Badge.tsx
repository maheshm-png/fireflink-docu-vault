import Link from "next/link";
import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "accent";

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: "bg-ff-lavender text-ff-textMuted",
  success: "bg-ff-success/15 text-ff-success",
  warning: "bg-ff-warning/15 text-ff-warning",
  danger: "bg-ff-danger/15 text-ff-danger",
  accent: "bg-ff-accent/15 text-ff-accent",
};

// Solid fill is a visually distinct, more urgent style than the soft /15
// tints above — reserved for things that genuinely need attention right now
// (a pending approval, a document waiting on you), never for a static fact
// (a category, a "Permanent" flag). Mixing the two into one softness was the
// actual source of "warning-orange means both 'act now' and 'just FYI'"
// confusion this component replaces.
const SOLID_VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: "bg-ff-textMuted text-white",
  success: "bg-ff-success text-white",
  warning: "bg-ff-warning text-white",
  danger: "bg-ff-danger text-white",
  accent: "bg-ff-accent-gradient text-white",
};

/**
 * Shared small pill used everywhere the app needs to say "here's a status,
 * flag, or count" — replaces ~15 previously hand-rolled instances that had
 * quietly drifted into inconsistent styling (soft vs solid fills used
 * interchangeably, some pulsing, some not, for no principled reason). Every
 * caller should reach for this instead of writing its own
 * `rounded-full ... px-2.5 py-1 ...` className by hand.
 *
 * `solid` + `pulse` together is the "this needs your attention right now"
 * treatment (e.g. "Waiting for review", "Pending Approval"); a plain
 * soft-tint badge with neither is the "here's a fact" treatment (e.g. a
 * category name, "Permanent").
 */
export default function Badge({
  children,
  variant = "neutral",
  solid = false,
  pulse = false,
  icon,
  tooltip,
  href,
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  solid?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  // Native title tooltip, matching the `detail` prop StatusBadge already
  // had before this component existed.
  tooltip?: string;
  // Renders as a Link instead of a plain span, for badges that are also
  // navigation (e.g. "Waiting for review" jumping to the Review tab).
  href?: string;
  className?: string;
}) {
  const classes = `inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
    solid ? SOLID_VARIANT_CLASS[variant] : VARIANT_CLASS[variant]
  } ${solid ? "font-semibold" : ""} ${pulse ? "animate-pulse" : ""} ${
    href ? "transition-colors hover:brightness-105" : ""
  } ${className}`;

  const content = (
    <>
      {icon}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} title={tooltip} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <span title={tooltip} className={classes}>
      {content}
    </span>
  );
}
