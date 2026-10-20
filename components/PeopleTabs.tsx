import Link from "next/link";

// One People area for superadmins: Users and Teams. (Designations were
// removed from the UI on 2026-10-12; they controlled nothing.) Shown at the top of each of those pages.
const TABS = [
  { key: "users", label: "Users", href: "/admin/users" },
  { key: "teams", label: "Teams", href: "/admin/teams" },
] as const;

export default function PeopleTabs({ active }: { active: (typeof TABS)[number]["key"] | "designations" }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-ff-border" aria-label="People">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            active === t.key
              ? "border-ff-accent font-medium text-ff-accent"
              : "border-transparent text-ff-textMuted hover:text-ff-text"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
