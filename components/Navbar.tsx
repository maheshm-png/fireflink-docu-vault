"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Home, Files, LayoutDashboard, HelpCircle, ShieldCheck, BarChart3, Users, ChevronDown, LogOut, Trash2, Settings,
  Sparkles, Megaphone, IdCard, RotateCcw, Archive, Tags, Search, KeyRound,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";

// Same client-side reset-email flow used on the logged-out /login page (see
// its handleResetRequest) — reused here so a signed-in user can trigger it
// on themselves without re-typing their email.
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type NavItem = { href: string; label: string; icon: typeof Files };

export default function Navbar({
  role,
  userName,
  userEmail,
  userDesignation,
}: {
  role: Role;
  userName: string;
  userEmail: string;
  userDesignation?: string | null;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  async function handleResetPassword() {
    setResetStatus("sending");
    setResetErrorMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setResetErrorMessage(error.message);
      setResetStatus("error");
      return;
    }
    setResetStatus("sent");
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

  // Published/Revoked are open to every role, same as before. Archived
  // reuses the Review Dashboard's own tab (app/dashboard/pending?status=
  // archived) and Deleted is the existing manager/superadmin-only recovery
  // page — both keep the exact same role gate their standalone pages
  // already enforce, just grouped here instead of listed separately.
  // Categories lives here too, not under Help — it's not documentation,
  // it's the config that defines what a category's upload form asks for
  // (with its own create/edit flow for managers), so it belongs with the
  // rest of the document-organizing structure rather than the Ask AI page.
  const documentsItems: NavItem[] = [
    { href: "/dashboard", label: "Published", icon: Files },
    { href: "/dashboard/revoked", label: "Revoked", icon: RotateCcw },
    ...(!isUser ? [{ href: "/dashboard/pending?status=archived", label: "Archived", icon: Archive }] : []),
    ...(isManagerUp ? [{ href: "/admin/deleted", label: "Deleted", icon: Trash2 }] : []),
    ...(!isUser ? [{ href: "/admin/categories", label: "Categories", icon: Tags }] : []),
  ];

  const helpItems: NavItem[] = [
    { href: "/dashboard/assistant", label: "Ask Docu AI", icon: Sparkles },
  ];

  const controlsItems: NavItem[] = [
    ...(isManagerUp ? [{ href: "/admin/audit-log", label: "Audit Log", icon: ShieldCheck }] : []),
    ...(isManagerUp ? [{ href: "/admin/analytics", label: "Analytics", icon: BarChart3 }] : []),
    ...(isManagerUp ? [{ href: "/admin/announcements", label: "Announcements", icon: Megaphone }] : []),
    ...(isManagerUp ? [{ href: "/admin/settings", label: "Settings", icon: Settings }] : []),
    ...(role === "superadmin" ? [{ href: "/admin/users", label: "Manage Users", icon: Users }] : []),
    ...(role === "superadmin" ? [{ href: "/admin/designations", label: "Designations", icon: IdCard }] : []),
  ];

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 bg-ff-plum-gradient px-3 text-white shadow-ff-lg sm:gap-3 sm:px-4">
      {/* Three regions (left/center/right) instead of one long flex row —
          center is its own flex-1 that centers its own content, so the nav
          sits in the true middle of the bar regardless of how wide the logo
          or the right-hand icon cluster happen to be, rather than just
          drifting left because it's next in DOM order. */}
      <div className="flex shrink-0 basis-0 items-center gap-2.5" style={{ flexGrow: 1 }}>
        <Link href="/dashboard/home" className="flex shrink-0 items-center gap-2.5">
          <Logo variant="white" width={130} height={32} priority />
          <span className="hidden h-5 w-px bg-white/25 sm:block" aria-hidden />
          <span className="hidden whitespace-nowrap text-lg font-bold uppercase tracking-wide text-white sm:block">
            Docu Vault
          </span>
        </Link>
      </div>

      <nav className="flex shrink-0 flex-wrap items-center justify-center gap-1">
        <NavLink item={{ href: "/dashboard/home", label: "Home", icon: Home }} active={pathname === "/dashboard/home"} />
        <NavDropdown label="Documents" icon={Files} items={documentsItems} currentPath={currentPath} />
        {!isUser && (
          <NavLink
            item={{ href: "/dashboard/pending", label: "Dashboard", icon: LayoutDashboard }}
            active={pathname === "/dashboard/pending"}
          />
        )}
        <NavDropdown label="Help" icon={HelpCircle} items={helpItems} currentPath={currentPath} />
        {controlsItems.length > 0 && (
          <NavDropdown label="Controls" icon={ShieldCheck} items={controlsItems} currentPath={currentPath} align="right" />
        )}
      </nav>

      <div className="flex basis-0 items-center justify-end gap-1.5 sm:gap-2" style={{ flexGrow: 1 }}>
        {/* Search icon that expands into an input on click, instead of a
            persistent box competing with the nav for space. */}
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

        <NotificationBell collapsed={false} />

        <div className="relative shrink-0">
          <button
            onClick={() => setProfileOpen((v) => { if (!v) setResetStatus("idle"); return !v; })}
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
                <dl className="space-y-2 border-t border-ff-border pt-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-ff-textMuted">Role</dt>
                    <dd className="min-w-0 max-w-[65%] break-words text-right font-medium text-ff-text">{ROLE_LABELS[role]}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-ff-textMuted">Designation</dt>
                    <dd className="min-w-0 max-w-[65%] break-words text-right font-medium text-ff-text">{userDesignation ?? "—"}</dd>
                  </div>
                </dl>

                <div className="mt-3 border-t border-ff-border pt-3">
                  <button
                    onClick={handleResetPassword}
                    disabled={resetStatus === "sending" || resetStatus === "sent"}
                    className="flex w-full items-center gap-2 rounded-ff px-1.5 py-1.5 text-left text-sm text-ff-text transition-colors hover:bg-ff-lavender/60 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <KeyRound className="h-4 w-4 shrink-0 text-ff-textMuted" aria-hidden />
                    {resetStatus === "sending" ? "Sending reset link..." : "Reset Password"}
                  </button>
                  {resetStatus === "sent" && (
                    <p className="mt-1 px-1.5 text-xs text-ff-success">Check your email for a reset link.</p>
                  )}
                  {resetStatus === "error" && (
                    <p className="mt-1 px-1.5 text-xs text-ff-danger">
                      {resetErrorMessage ?? "Could not send the reset link. Please try again."}
                    </p>
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
