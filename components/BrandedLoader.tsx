import Logo from "./Logo";

/**
 * FireFlink-branded loading indicator (pulsing icon mark) used anywhere the
 * app is waiting on something — button busy states and route transitions —
 * instead of a generic spinner or plain "Loading..." text.
 */
export default function BrandedLoader({
  size = 20,
  label,
  fullPage = false,
  variant = "color",
}: {
  size?: number;
  label?: string;
  fullPage?: boolean;
  /** Use "white" on colored buttons (e.g. bg-ff-accent) where the colored mark wouldn't show up. */
  variant?: "color" | "white";
}) {
  const mark = <Logo variant={variant} icon width={size} height={size} className="animate-brand-pulse" />;

  if (fullPage) {
    return (
      <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3">
        <Logo icon width={40} height={40} className="animate-brand-pulse" />
        {label && <p className="text-sm text-ff-textMuted">{label}</p>}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {mark}
      {label && <span>{label}</span>}
    </span>
  );
}
