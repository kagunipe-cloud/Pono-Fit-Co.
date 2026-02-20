"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/branding";
import { SECTIONS } from "../lib/sections";

type MemberMe = {
  member_id: string;
  email: string | null;
  name: string;
  role?: string | null;
} | null;

function NavList({
  pathname,
  member,
  isMember,
  isAdmin,
  showMemberNav,
  onLogout,
}: {
  pathname: string | null;
  member: MemberMe;
  isMember: boolean;
  isAdmin: boolean;
  showMemberNav: boolean;
  onLogout: () => void;
}) {
  const link = (href: string, label: string | React.ReactNode, active?: boolean) => {
    const isActive = active ?? (pathname === href || (href !== "/" && pathname?.startsWith(href + "/")));
    return (
      <Link
        href={href}
        className={`block px-3 py-2 rounded-lg text-sm font-medium ${
          isActive ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  if (showMemberNav) {
    return (
      <ul className="space-y-0.5">
        <li>{link("/member", "Home", pathname === "/member")}</li>
        <li>{link("/member/membership", "My Membership")}</li>
        <li>
          <Link
            href="/schedule"
            className={`block px-3 py-2 rounded-lg text-sm font-medium ${
              pathname === "/schedule" || pathname?.startsWith("/schedule/")
                ? "bg-brand-50 text-brand-800"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <span className="block">Schedule</span>
            <span className="block text-xs font-normal text-stone-500 mt-0.5">Book Classes & PT</span>
          </Link>
        </li>
        <li>{link("/member/class-bookings", "My Class Bookings")}</li>
        <li>{link("/member/pt-bookings", "My PT Bookings")}</li>
        <li>{link("/member/workouts", "Workouts", pathname?.startsWith("/member/workouts"))}</li>
        <li>{link("/member/macros", "Macros", pathname?.startsWith("/member/macros"))}</li>
        <li>{link("/rec-leagues", "Rec Leagues", pathname?.startsWith("/rec-leagues"))}</li>
        <li className="pt-2 mt-2 border-t border-stone-100">
          <span className="block px-3 py-1 text-xs font-medium text-stone-400">Purchase</span>
        </li>
        <li>{link("/member/classes", "Browse Classes")}</li>
        <li>{link("/member/pt-sessions", "Browse PT Sessions")}</li>
        <li>{link("/member/class-packs", "Class Packs")}</li>
        <li>{link("/member/pt-packs", "PT Packs")}</li>
        <li>{link("/member/memberships", "Memberships")}</li>
        <li>{link("/member/cart", "Cart")}</li>
        {!isMember && (
          <li className="pt-2 mt-2 border-t border-stone-100">
            <Link href="/login" className="block px-3 py-2 rounded-lg text-sm font-medium text-brand-600 hover:bg-brand-50">
              Log in
            </Link>
          </li>
        )}
        {isMember && (
          <li className="pt-2 mt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onLogout}
              className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              Log Out
            </button>
          </li>
        )}
      </ul>
    );
  }

  return (
    <ul className="space-y-0.5">
      <li>{link("/", "Home", pathname === "/")}</li>
      {!isMember && (
        <li>
          <Link href="/login" className="block px-3 py-2 rounded-lg text-sm font-medium text-brand-600 hover:bg-brand-50">
            Login
          </Link>
        </li>
      )}
      <li>{link("/schedule", "Schedule", pathname === "/schedule" || pathname?.startsWith("/schedule/"))}</li>
      <li>{link("/rec-leagues", "Rec Leagues", pathname?.startsWith("/rec-leagues"))}</li>
      {isAdmin && <li>{link("/master-schedule", "Master Schedule")}</li>}
      {isAdmin && <li>{link("/admin/create-workout-for-member", "Create Workout for Member")}</li>}
      {isAdmin && <li>{link("/exercises", "Exercises")}</li>}
      {isAdmin && <li>{link("/macros", "Macros")}</li>}
      {isAdmin && <li>{link("/admin/backup", "Backup & Restore")}</li>}
      {isAdmin && <li>{link("/admin/email-members", "Email all members")}</li>}
      <li>{link("/class-packs", "Class Packs")}</li>
      <li>{link("/pt-packs", "PT Packs")}</li>
      {SECTIONS.map((s) => (
        <li key={s.slug}>{link(`/${s.slug}`, s.title, pathname === `/${s.slug}`)}</li>
      ))}
      {isAdmin && (
        <>
          <li className="pt-2 mt-2 border-t border-stone-100">
            <span className="block px-3 py-1 text-xs font-medium text-stone-400">Member area</span>
          </li>
          <li>{link("/member", "Member home", pathname === "/member")}</li>
          <li>{link("/member/workouts", "My Workouts", pathname?.startsWith("/member/workouts"))}</li>
          <li>{link("/member/macros", "My Macros", pathname?.startsWith("/member/macros"))}</li>
          <li className="pt-2 mt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onLogout}
              className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              Log Out
            </button>
          </li>
        </>
      )}
    </ul>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [member, setMember] = useState<MemberMe | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMember(data ?? null))
      .catch(() => setMember(null));
  }, [pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/member-logout", { method: "POST" });
    setMember(null);
    setMobileMenuOpen(false);
    router.push("/");
    router.refresh();
  }

  const isMember = member !== undefined && member !== null;
  const isAdmin = member?.role === "Admin";
  const inMemberArea = pathname === "/member" || pathname?.startsWith("/member/");
  // Prior to login: show member nav so visitors see what the app offers. After login, show member nav in member area or admin nav elsewhere.
  const showMemberNav = !isMember || inMemberArea;

  const logoHref = isMember ? (showMemberNav ? "/member" : "/") : "/";
  const navProps = { pathname, member: member ?? null, isMember, isAdmin, showMemberNav, onLogout: handleLogout };

  return (
    <>
      {/* Mobile: fixed header with hamburger */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-stone-200 flex items-center justify-between px-4 safe-area-inset">
        <Link href={logoHref} className="flex items-center shrink-0" aria-label={BRAND.name} onClick={() => setMobileMenuOpen(false)}>
          <img src="/Logo-w-gray.svg" alt="" className="h-8 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 -mr-2 rounded-lg text-stone-600 hover:bg-stone-100"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          <span className="sr-only">{mobileMenuOpen ? "Close menu" : "Open menu"}</span>
          {mobileMenuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>
      </div>

      {/* Mobile: overlay + drawer when menu open */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-stone-900/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-stone-100 shrink-0">
              <Link href={logoHref} className="block rounded-lg overflow-hidden" onClick={() => setMobileMenuOpen(false)}>
                <img src="/Logo-w-gray.svg" alt={BRAND.name} className="w-full h-auto block" />
              </Link>
              {isMember && member && (
                <p className="text-xs text-stone-500 mt-1 truncate" title={member.email ?? undefined}>{member.name}</p>
              )}
            </div>
            <nav className="p-2 flex-1 overflow-y-auto">
              <NavList {...navProps} />
            </nav>
          </div>
        </>
      )}

      {/* Desktop: sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-stone-200 bg-white flex-col">
      <div className="p-4 border-b border-stone-100">
        <Link href={logoHref} className="block rounded-lg bg-white overflow-hidden" aria-label={BRAND.name}>
          <img src="/Logo-w-gray.svg" alt={BRAND.name} className="w-full h-auto block" />
        </Link>
        {isMember && member && (
          <p className="text-xs text-stone-500 mt-1 truncate" title={member.email ?? undefined}>{member.name}</p>
        )}
      </div>
      <nav className="p-2 flex-1 overflow-y-auto">
        <NavList {...navProps} />
      </nav>
    </aside>
    </>
  );
}
