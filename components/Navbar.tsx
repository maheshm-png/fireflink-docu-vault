"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Home, Files, HelpCircle, ShieldCheck, BarChart3, Users, ChevronDown, LogOut, Trash2, Settings,
  Sparkles, Megaphone, Tags, Search, KeyRound, BookOpenText, Mail, LayoutGrid, Briefcase, Newspaper,
  Building2, UserRound,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/rbac";
import InfoTooltip from "./InfoTooltip";
import { ORG_LEVEL, TEAM_LEVEL } from "@/lib/roleCopy";
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";
import PlumWatermark from "./PlumWatermark";

// Same client-side reset-email flow used on the logged-out /login page (see
// its handleResetRequest) — reused here so a signed-in user can trigger it
// on themselves without re-typing their email.
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type NavItem = { href: string; label: string; icon: typeof Files; title?: string };

// One branch of the profile menu's access tree: an elbow connector from the
// root's trunk, plus the trunk carried on past this row unless it's the last.
function TreeBranch({ last, children }: { last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex items-center gap-2 py-1 pl-7">
      <span aria-hidden className="absolute left-3 top-0 h-1/2 w-3 rounded-bl border-b border-l border-ff-border" />
      {!last && <span aria-hidden className="absolute bottom-0 left-3 top-1/2 border-l border-ff-border" />}
      {children}
    </li>
  );
}

function RolePill({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        strong ? "bg-ff-accent text-white" : "bg-ff-lavender text-ff-accent"
      }`}
    >
      {label}
    </span>
  );
}

export default function Navbar({
  role,
  userName,
  userEmail,
  userTeam,
  userReportsTo,
}: {
  role: Role;
  userName: string;
  userEmail: string;
  userTeam?: string | null;
  userReportsTo?: string | null;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeStatus, setChangeStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [changeErrorMessage, setChangeErrorMessage] = useState<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onMyTeams = pathname === "/dashboard" && searchParams.get("space") === "teams";
  // Full path+query, so a dropdown item like "/dashboard/pending?status=
  // archived" can actually be matched — usePathname() alone drops the query
  // string, so plain equality against pathname would never highlight it.
  const currentPath = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global search, available from any page — reflects the active query when
  // already on Published Documents (pathname === "/dashboard"), starts
  // empty everywhere else. Collapsed to an icon until clicked, so it
  // doesn't compete for space with the nav items.
  const [q, setQ] = useState(pathname === "/dashboard" ? searchParams.get("q") ?? "" : "");

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(pathname === "/dashboard" ? searchParams.toString() : undefined);
    if (q) next.set("q", q);
    else next.delete("q");
    router.push(`/dashboard?${next.toString()}`);
  }

  function resetChangePasswordForm() {
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangeStatus("idle");
    setChangeErrorMessage(null);
  }

  // Requires the current password rather than just calling
  // supabase.auth.updateUser directly — that call only needs an active
  // session and would let anyone at an already-unlocked device change the
  // password without knowing it. Verifying by actually signing in with it
  // first (discarding that second session immediately after) is the
  // simplest way to enforce that dependency client-side, since Supabase
  // doesn't expose a "reauthenticate with password" call of its own.
  // Someone who's forgotten their current password entirely has no
  // self-service path here on purpose — that's what the admin is for.
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setChangeErrorMessage("New password and confirmation don't match.");
      setChangeStatus("error");
      return;
    }
    if (newPassword.length < 8) {
      setChangeErrorMessage("New password must be at least 8 characters.");
      setChangeStatus("error");
      return;
    }
    setChangeStatus("saving");
    setChangeErrorMessage(null);

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword,
    });
    if (verifyError) {
      setChangeErrorMessage("Current password is incorrect.");
      setChangeStatus("error");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setChangeErrorMessage(updateError.message);
      setChangeStatus("error");
      return;
    }
    setChangeStatus("success");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleLogout() {
    setLoggingOut(true);
    // Server-side sign-out (clears the auth cookies) rather than a browser
    // Supabase client here — that would pull the whole supabase-js bundle
    // into every page's JS just for this one button.
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isUser = role === "user";
  const isManagerUp = role === "manager" || role === "superadmin";
  // A "user" org role can still have My Work through a team role;
  // only the server knows, so ask it (once per mount).
  const [teamWork, setTeamWork] = useState(false);
  useEffect(() => {
    if (!isUser) return;
    let cancelled = false;
    fetch("/api/my-work-access")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.myWork) setTeamWork(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isUser]);
  const showMyWork = !isUser || teamWork;

  // Archived documents are a status filter on My Work; Deleted (the
  // manager/superadmin recovery page) sits in Controls.
  const helpItems: NavItem[] = [
    { href: "/dashboard/assistant", label: "Ask Docu AI", icon: Sparkles },
    { href: "/dashboard/help", label: "What can I do?", icon: BookOpenText },
    { href: "/dashboard/release-notes", label: "Release notes", icon: Newspaper },
    // Contributors look categories up (what each one's upload form asks
    // for); managers and superadmins edit them, so theirs sits in Controls
    // next to Settings instead.
    ...(role === "contributor" ? [{ href: "/admin/categories", label: "Categories", icon: Tags }] : []),
    {
      href: "mailto:docuvault@fireflink.com?subject=FireFlink%20Docu%20Vault%20Support",
      label: "Contact Support",
      icon: Mail,
      title: "docuvault@fireflink.com",
    },
  ];

  const controlsItems: NavItem[] = [
    ...(isManagerUp ? [{ href: "/admin/audit-log", label: "Audit Log", icon: ShieldCheck }] : []),
    ...(isManagerUp ? [{ href: "/admin/analytics", label: "Analytics", icon: BarChart3 }] : []),
    ...(isManagerUp ? [{ href: "/admin/announcements", label: "Announcements", icon: Megaphone }] : []),
    ...(isManagerUp ? [{ href: "/admin/settings", label: "Settings", icon: Settings }] : []),
    ...(isManagerUp ? [{ href: "/admin/categories", label: "Categories", icon: Tags }] : []),
    ...(isManagerUp ? [{ href: "/admin/deleted", label: "Deleted", icon: Trash2 }] : []),
    // Users and Teams are tabs of one People page.
    ...(role === "superadmin" ? [{ href: "/admin/users", label: "People", icon: Users }] : []),
    ...(role === "superadmin" ? [{ href: "/admin/workspace-apps", label: "Presales Team Assets", icon: LayoutGrid }] : []),
  ];

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2 bg-ff-plum-gradient px-3 text-white shadow-ff-lg sm:gap-3 sm:px-4">
      {/* Three regions (left/center/right) instead of one long flex row —
          center is its own flex-1 that centers its own content, so the nav
          sits in the true middle of the bar regardless of how wide the logo
          or the right-hand icon cluster happen to be, rather than just
          drifting left because it's next in DOM order. */}
      <div className="relative flex shrink-0 basis-0 items-center gap-2.5 overflow-hidden" style={{ flexGrow: 1 }}>
        {/* Clipped to THIS flex region only, not the whole header (which
            would also clip the nav dropdowns and profile menu below them) —
            sits in the leftover space after the logo, so it never overlaps
            the logo, the centered nav, or the icon cluster on the right. */}
        <PlumWatermark className="absolute -top-8 left-40 z-0 hidden w-20 sm:block" />
        <Link href="/dashboard" className="relative z-10 flex shrink-0 items-center gap-2.5">
          <Logo variant="white" width={130} height={32} priority />
          <span className="hidden h-5 w-px bg-white/25 sm:block" aria-hidden />
          <span className="hidden whitespace-nowrap text-lg font-bold uppercase tracking-wide text-white sm:block">
            Docu Vault
          </span>
        </Link>
      </div>

      <nav className="flex shrink-0 flex-wrap items-center justify-center gap-1">
        {/* Home is the published documents page (the separate Home page was merged into it). */}
        <NavLink item={{ href: "/dashboard", label: "Home", icon: Home }} active={pathname === "/dashboard"} />
        {showMyWork && (
          <NavLink
            item={{ href: "/dashboard/my-work", label: "My Work", icon: Briefcase }}
            active={pathname === "/dashboard/my-work"}
          />
        )}
        <NavDropdown label="Help" icon={HelpCircle} items={helpItems} currentPath={currentPath} />
        {controlsItems.length > 0 && (
          <NavDropdown label="Controls" icon={ShieldCheck} items={controlsItems} currentPath={currentPath} align="right" />
        )}
      </nav>

      <div className="flex basis-0 items-center justify-end gap-1.5 sm:gap-2" style={{ flexGrow: 1 }}>
        {/* Search icon that expands into an input on click, instead of a
            persistent box competing with the nav for space. Hidden on Home >
            My teams, which has its own search box over the open team's
            documents (the site-wide search doesn't cover team documents). */}
        {!onMyTeams && (
        <div className="relative shrink-0">
          {searchOpen ? (
            <form
              onSubmit={handleSearch}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false);
              }}
              className="flex w-40 items-center gap-1.5 rounded-ff border border-white/30 bg-white/10 px-2 py-1.5 sm:w-56"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden />
              <input
                ref={searchInputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
                placeholder="Search documents..."
                aria-label="Search documents"
                className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
              />
            </form>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search documents"
              title="Search"
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Search className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        )}

        <NotificationBell collapsed={false} />

        <div className="relative shrink-0">
          <button
            onClick={() => setProfileOpen((v) => { if (!v) resetChangePasswordForm(); return !v; })}
            aria-label="Your profile"
            title={userName}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold uppercase transition-colors hover:bg-white/25"
          >
            {userName.charAt(0)}
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setProfileOpen(false)} />
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] animate-fade-in rounded-ff border border-ff-border bg-white p-4 text-ff-text shadow-ff-lg"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ff-lavender text-sm font-semibold uppercase text-ff-accent">
                    {userName.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ff-text">{userName}</div>
                    <div className="truncate text-xs text-ff-textMuted">{userEmail}</div>
                  </div>
                </div>
                {/* Access tree: the org (org role) at the root, one branch per
                    team (team role), then who they report to. userTeam is
                    "BD (Manager), Sales (Contributor)". */}
                <div className="border-t border-ff-border pt-3 text-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ff-textMuted">Your access</div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ff-accent text-white">
                      <Building2 className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ff-text">FireFlink</span>
                      <span className="flex items-center gap-1 text-xs text-ff-textMuted">
                        Org role
                        <InfoTooltip text={`${ORG_LEVEL.covers}. ${ROLE_DESCRIPTIONS[role]}`} align="right" />
                      </span>
                    </span>
                    <RolePill label={ROLE_LABELS[role]} strong />
                  </div>
                  <ul>
                    {(() => {
                      const teams = (userTeam ? userTeam.split(", ") : []).map((entry) => {
                        const m = entry.match(/^(.*) \((.*)\)$/);
                        return m ? { name: m[1], role: m[2] } : { name: entry, role: "" };
                      });
                      if (teams.length === 0) {
                        return (
                          <TreeBranch last>
                            <span className="text-xs italic text-ff-textMuted">Not in any team</span>
                          </TreeBranch>
                        );
                      }
                      return teams.map((t, i) => (
                        <TreeBranch key={t.name} last={i === teams.length - 1}>
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ff-lavender text-ff-accent">
                            <Users className="h-3 w-3" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ff-text">{t.name}</span>
                            <span className="flex items-center gap-1 text-xs text-ff-textMuted">
                              Team role
                              {i === 0 && <InfoTooltip text={`${TEAM_LEVEL.covers}.`} align="right" />}
                            </span>
                          </span>
                          {t.role && <RolePill label={t.role} />}
                        </TreeBranch>
                      ));
                    })()}
                  </ul>
                  <div className="mt-3 flex items-center gap-2 rounded-ff bg-ff-lavender/40 px-2 py-1.5">
                    <UserRound className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
                    <span className="text-xs text-ff-textMuted">Reports to</span>
                    <span className="ml-auto min-w-0 truncate text-sm font-medium text-ff-text">{userReportsTo ?? "No one"}</span>
                  </div>
                  <Link href="/dashboard/help" className="mt-2 block text-xs text-ff-accent hover:underline">
                    What can I do?
                  </Link>
                </div>

                <div className="mt-3 border-t border-ff-border pt-3">
                  {!changingPassword ? (
                    <button
                      onClick={() => setChangingPassword(true)}
                      className="flex w-full items-center gap-2 rounded-ff px-1.5 py-1.5 text-left text-sm text-ff-text transition-colors hover:bg-ff-lavender/60"
                    >
                      <KeyRound className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
                      Change Password
                    </button>
                  ) : (
                    <form onSubmit={handleChangePassword} className="space-y-2">
                      <div className="flex items-center gap-2 px-1.5 text-sm font-medium text-ff-text">
                        <KeyRound className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
                        Change Password
                      </div>
                      <input
                        type="password"
                        required
                        autoFocus
                        placeholder="Current password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm outline-none focus:border-ff-accent"
                      />
                      <input
                        type="password"
                        required
                        placeholder="New password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm outline-none focus:border-ff-accent"
                      />
                      <input
                        type="password"
                        required
                        placeholder="Confirm new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full rounded-ff border border-ff-border px-2.5 py-1.5 text-sm outline-none focus:border-ff-accent"
                      />
                      {changeStatus === "error" && (
                        <p className="px-1.5 text-xs text-ff-danger">{changeErrorMessage}</p>
                      )}
                      {changeStatus === "success" && (
                        <p className="px-1.5 text-xs text-ff-success">Password changed.</p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={changeStatus === "saving"}
                          className="rounded-ff bg-ff-accent-gradient px-3 py-1.5 text-xs font-medium text-white shadow-ff transition-all hover:shadow-ff-md hover:brightness-105 disabled:opacity-60"
                        >
                          {changeStatus === "saving" ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={resetChangePasswordForm}
                          className="rounded-ff border border-ff-border px-3 py-1.5 text-xs text-ff-text transition-colors hover:bg-ff-lavender/40"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="px-1.5 pt-1 text-xs text-ff-textMuted">
                        Forgotten your current password entirely? Contact your admin to have it reset.
                      </p>
                    </form>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="Log out"
          title="Log out"
          className="shrink-0 rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ff px-2.5 py-2 text-sm transition-colors sm:px-3 ${
        active
          ? "bg-gradient-to-b from-white/20 to-white/10 text-white"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="hidden lg:inline">{item.label}</span>
    </Link>
  );
}

/** One of Documents/Help/Controls. Its dropdown panel is position:absolute,
 * so it needs a plain (non-overflow-clipping) ancestor chain up to the
 * nearest positioned element — see the comment on <nav> above for why that
 * used to break. */
function NavDropdown({
  label,
  icon: Icon,
  items,
  currentPath,
  align = "left",
}: {
  label: string;
  icon: typeof Files;
  items: NavItem[];
  currentPath: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const isActiveGroup = items.some((item) => item.href === currentPath);

  if (items.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={label}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-ff px-2.5 py-2 text-sm transition-colors sm:px-3 ${
          isActiveGroup || open
            ? "bg-gradient-to-b from-white/20 to-white/10 text-white"
            : "text-white/80 hover:bg-white/10 hover:text-white"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setOpen(false)} />
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute top-full z-50 mt-1 w-56 animate-fade-in rounded-ff border border-ff-border bg-white p-1.5 text-ff-text shadow-ff-lg ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {items.map((item) => {
              const ItemIcon = item.icon;
              const active = item.href === currentPath;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.title}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-ff px-3 py-2 text-sm transition-colors ${
                    active ? "bg-ff-lavender text-ff-accent" : "text-ff-text hover:bg-ff-lavender/60"
                  }`}
                >
                  <ItemIcon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
