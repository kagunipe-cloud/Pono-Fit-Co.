"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/branding";
import { SECTIONS, getReportSubSections, REPORT_SUB_SLUGS } from "../lib/sections";

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
  isTrainer,
  showMemberNav,
  onLogout,
}: {
  pathname: string | null;
  member: MemberMe;
  isMember: boolean;
  isAdmin: boolean;
  isTrainer: boolean;
  showMemberNav: boolean;
  onLogout: () => void;
}) {
  const [reportsOpen, setReportsOpen] = useState(false);
  const reportsRef = useRef<HTMLLIElement>(null);
  const reportsButtonRef = useRef<HTMLButtonElement>(null);
  const reportsDropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  const [trainerSchedulesOpen, setTrainerSchedulesOpen] = useState(false);
  const trainerSchedulesRef = useRef<HTMLLIElement>(null);
  const trainerSchedulesButtonRef = useRef<HTMLButtonElement>(null);
  const trainerSchedulesDropdownRef = useRef<HTMLDivElement>(null);
  const [trainerSchedulesPosition, setTrainerSchedulesPosition] = useState({ top: 0, left: 0 });
  const [trainersList, setTrainersList] = useState<{ member_id: string; display_name: string }[]>([]);

  useEffect(() => {
    setReportsOpen(false);
    setTrainerSchedulesOpen(false);
  }, [pathname]);

  // Position dropdown to the right of the Reports button (for portal)
  useEffect(() => {
    if (!reportsOpen || !reportsButtonRef.current) return;
    const rect = reportsButtonRef.current.getBoundingClientRect();
    setDropdownPosition({ top: rect.top, left: rect.right });
  }, [reportsOpen]);

  // Position Trainer schedules dropdown to the right
  useEffect(() => {
    if (!trainerSchedulesOpen || !trainerSchedulesButtonRef.current) return;
    const rect = trainerSchedulesButtonRef.current.getBoundingClientRect();
    setTrainerSchedulesPosition({ top: rect.top, left: rect.right });
  }, [trainerSchedulesOpen]);

  // Fetch trainers when Trainer schedules dropdown is opened
  useEffect(() => {
    if (!trainerSchedulesOpen || trainersList.length > 0) return;
    fetch("/api/trainers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { member_id: string; display_name: string }[]) => setTrainersList(Array.isArray(data) ? data : []))
      .catch(() => setTrainersList([]));
  }, [trainerSchedulesOpen, trainersList.length]);

  // Close reports dropdown when clicking outside (sidebar row or dropdown panel)
  useEffect(() => {
    if (!reportsOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inReports = reportsRef.current?.contains(target);
      const inDropdown = reportsDropdownRef.current?.contains(target);
      if (!inReports && !inDropdown) setReportsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [reportsOpen]);

  // Close Trainer schedules dropdown when clicking outside
  useEffect(() => {
    if (!trainerSchedulesOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inRow = trainerSchedulesRef.current?.contains(target);
      const inDropdown = trainerSchedulesDropdownRef.current?.contains(target);
      if (!inRow && !inDropdown) setTrainerSchedulesOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [trainerSchedulesOpen]);
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

  const reportSubs = getReportSubSections();
  const mainSections = SECTIONS.filter((s) => !REPORT_SUB_SLUGS.includes(s.slug));
  const isOnReportPage = pathname != null && REPORT_SUB_SLUGS.some((slug) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`));

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
      {isTrainer && (
        <li>{link("/trainer", member?.role === "Admin" ? "Trainer schedule" : "My Schedule", pathname === "/trainer" || pathname?.startsWith("/trainer/"))}</li>
      )}
      <li>{link("/rec-leagues", "Rec Leagues", pathname?.startsWith("/rec-leagues"))}</li>
      {!isAdmin && <li>{link("/schedule", "Schedule", pathname === "/schedule" || pathname?.startsWith("/schedule/"))}</li>}
      {isAdmin && <li>{link("/master-schedule", "Master Schedule")}</li>}
      {isAdmin && (
        <li ref={trainerSchedulesRef} className="relative">
          <button
            ref={trainerSchedulesButtonRef}
            type="button"
            onClick={() => setTrainerSchedulesOpen((open) => !open)}
            className={`w-full text-left block px-3 py-2 rounded-lg text-sm font-medium ${
              pathname === "/schedule" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            <span className="flex items-center justify-between gap-1">
              Trainer schedules
              <svg
                className={`w-4 h-4 shrink-0 transition-transform ${trainerSchedulesOpen ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>
          {trainerSchedulesOpen &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={trainerSchedulesDropdownRef}
                className="fixed min-w-[12rem] max-h-[70vh] overflow-y-auto py-1 rounded-lg border border-stone-200 bg-white shadow-lg z-[100]"
                style={{ top: trainerSchedulesPosition.top, left: trainerSchedulesPosition.left, marginLeft: 4 }}
                role="menu"
              >
                {trainersList.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-stone-500">No trainers yet</div>
                ) : (
                  trainersList.map((t) => (
                    <Link
                      key={t.member_id}
                      href={`/schedule?trainer=${encodeURIComponent(t.member_id)}`}
                      className="block px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      role="menuitem"
                      onClick={() => setTrainerSchedulesOpen(false)}
                    >
                      {t.display_name}
                    </Link>
                  ))
                )}
              </div>,
              document.body
            )}
        </li>
      )}
      {isAdmin && <li>{link("/admin/block-time", "Block time")}</li>}
      {isAdmin && <li>{link("/admin/create-workout-for-member", "Create Workout for Member")}</li>}
      {isAdmin && <li>{link("/exercises", "Exercises")}</li>}
      {isAdmin && <li>{link("/macros", "Macros")}</li>}
      {isAdmin && <li>{link("/admin/backup", "Backup & Restore")}</li>}
      {isAdmin && <li>{link("/admin/import-members", "Import members")}</li>}
      {isAdmin && <li>{link("/admin/settings", "Settings")}</li>}
      {isAdmin && <li>{link("/admin/usage", "Usage tracking")}</li>}
      {isAdmin && <li>{link("/admin/email-members", "Email all members")}</li>}
      <li>{link("/class-packs", "Class Packs")}</li>
      <li>{link("/pt-packs", "PT Packs")}</li>
      {mainSections.map((s) => (
        <li key={s.slug}>{link(`/${s.slug}`, s.title, pathname === `/${s.slug}`)}</li>
      ))}
      <li ref={reportsRef} className="relative">
        <button
          ref={reportsButtonRef}
          type="button"
          onClick={() => setReportsOpen((open) => !open)}
          className={`w-full text-left block px-3 py-2 rounded-lg text-sm font-medium ${
            isOnReportPage ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
          }`}
        >
          <span className="flex items-center justify-between gap-1">
            Reports
            <svg
              className={`w-4 h-4 shrink-0 transition-transform ${reportsOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>
        {reportsOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={reportsDropdownRef}
              className="fixed min-w-[10rem] py-1 rounded-lg border border-stone-200 bg-white shadow-lg z-[100]"
              style={{ top: dropdownPosition.top, left: dropdownPosition.left, marginLeft: 4 }}
              role="menu"
            >
              {reportSubs.map(({ slug, title }) => (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className={`block px-3 py-2 text-sm font-medium ${
                    pathname === `/${slug}` ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                  role="menuitem"
                  onClick={() => setReportsOpen(false)}
                >
                  {title}
                </Link>
              ))}
            </div>,
            document.body
          )}
      </li>
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
  const isTrainer = member?.role === "Trainer" || member?.role === "Admin";
  const inMemberArea = pathname === "/member" || pathname?.startsWith("/member/");
  const inTrainerArea = pathname === "/trainer" || pathname?.startsWith("/trainer/");
  // Prior to login: show member nav so visitors see what the app offers. After login, show member nav in member area or admin nav elsewhere.
  const showMemberNav = !isMember || inMemberArea;

  const logoHref = isMember ? (showMemberNav ? "/member" : inTrainerArea ? "/trainer" : "/") : "/";
  const navProps = { pathname, member: member ?? null, isMember, isAdmin, isTrainer, showMemberNav, onLogout: handleLogout };

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
