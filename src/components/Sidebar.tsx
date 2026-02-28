"use client";

import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/branding";
import { SECTIONS, getReportSubSections, getBookingsSubSections, REPORT_SUB_SLUGS, BOOKINGS_SUB_SLUGS, SERVICES_SUB_SLUGS } from "../lib/sections";

/** 1px theme-green outline around white sidebar text */
const sidebarTextOutline = (() => {
  const c = BRAND.primary.DEFAULT;
  return { textShadow: `1px 0 0 ${c}, -1px 0 0 ${c}, 0 1px 0 ${c}, 0 -1px 0 ${c}, 1px 1px 0 ${c}, -1px -1px 0 ${c}, 1px -1px 0 ${c}, -1px 1px 0 ${c}` };
})();

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

  const [bookingsOpen, setBookingsOpen] = useState(false);
  const bookingsRef = useRef<HTMLLIElement>(null);
  const bookingsButtonRef = useRef<HTMLButtonElement>(null);
  const bookingsDropdownRef = useRef<HTMLDivElement>(null);
  const [bookingsPosition, setBookingsPosition] = useState({ top: 0, left: 0 });

  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef<HTMLLIElement>(null);
  const servicesButtonRef = useRef<HTMLButtonElement>(null);
  const servicesDropdownRef = useRef<HTMLDivElement>(null);
  const [servicesPosition, setServicesPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    setReportsOpen(false);
    setBookingsOpen(false);
    setServicesOpen(false);
  }, [pathname]);

  // Position dropdown to the right of the Reports button (for portal)
  useEffect(() => {
    if (!reportsOpen || !reportsButtonRef.current) return;
    const rect = reportsButtonRef.current.getBoundingClientRect();
    setDropdownPosition({ top: rect.top, left: rect.right });
  }, [reportsOpen]);

  // Position Bookings dropdown to the right
  useEffect(() => {
    if (!bookingsOpen || !bookingsButtonRef.current) return;
    const rect = bookingsButtonRef.current.getBoundingClientRect();
    setBookingsPosition({ top: rect.top, left: rect.right });
  }, [bookingsOpen]);

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

  // Close Bookings dropdown when clicking outside
  useEffect(() => {
    if (!bookingsOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inRow = bookingsRef.current?.contains(target);
      const inDropdown = bookingsDropdownRef.current?.contains(target);
      if (!inRow && !inDropdown) setBookingsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bookingsOpen]);

  // Position Services dropdown to the right
  useEffect(() => {
    if (!servicesOpen || !servicesButtonRef.current) return;
    const rect = servicesButtonRef.current.getBoundingClientRect();
    setServicesPosition({ top: rect.top, left: rect.right });
  }, [servicesOpen]);

  // Close Services dropdown when clicking outside
  useEffect(() => {
    if (!servicesOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inRow = servicesRef.current?.contains(target);
      const inDropdown = servicesDropdownRef.current?.contains(target);
      if (!inRow && !inDropdown) setServicesOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [servicesOpen]);
  const link = (href: string, label: string | React.ReactNode, active?: boolean) => {
    const isActive = active ?? (pathname === href || (href !== "/" && pathname?.startsWith(href + "/")));
    return (
      <Link
        href={href}
        className={`block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500 ${
          isActive ? "bg-brand-500/20" : ""
        }`}
        style={sidebarTextOutline}
      >
        {label}
      </Link>
    );
  };

  const reportSubs = getReportSubSections();
  const bookingsSubs = getBookingsSubSections();
  const mainSections = SECTIONS.filter(
    (s) => !REPORT_SUB_SLUGS.includes(s.slug) && !BOOKINGS_SUB_SLUGS.includes(s.slug) && !SERVICES_SUB_SLUGS.includes(s.slug)
  );
  const isOnReportPage = pathname != null && (REPORT_SUB_SLUGS.some((slug) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`)) || pathname === "/admin/usage" || pathname.startsWith("/admin/usage/"));
  const isOnBookingsPage = pathname != null && BOOKINGS_SUB_SLUGS.some((slug) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`));
  const isOnServicesPage = pathname != null && (pathname.startsWith("/rec-leagues") || pathname.startsWith("/class-packs") || pathname.startsWith("/pt-packs") || SERVICES_SUB_SLUGS.some((slug) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`)));

  if (showMemberNav) {
    return (
      <ul className="space-y-0.5">
        <li>{link("/member", "Home", pathname === "/member")}</li>
        <li>{link("/member/membership", "My Membership")}</li>
        <li>
          <Link
            href="/schedule"
            className={`block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500 ${
              pathname === "/schedule" || pathname?.startsWith("/schedule/")
                ? "bg-brand-500/20"
                : ""
            }`}
            style={sidebarTextOutline}
          >
            <span className="block">Schedule</span>
            <span className="block text-xs font-normal text-stone-600 mt-0.5">Book Classes & PT</span>
          </Link>
        </li>
        <li ref={bookingsRef} className="relative">
          <button
            ref={bookingsButtonRef}
            type="button"
            onClick={() => setBookingsOpen((open) => !open)}
            className="w-full text-left block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500"
            style={sidebarTextOutline}
          >
            <span className="flex items-center justify-between gap-1">
              Bookings
              <svg
                className={`w-4 h-4 shrink-0 transition-transform ${bookingsOpen ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>
          {bookingsOpen &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={bookingsDropdownRef}
                className="fixed min-w-[10rem] py-1 rounded-lg border border-stone-200 bg-white shadow-lg z-[100]"
                style={{ top: bookingsPosition.top, left: bookingsPosition.left, marginLeft: 4 }}
                role="menu"
              >
                <Link
                  href="/member/class-bookings"
                  className="block px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  role="menuitem"
                  onClick={() => setBookingsOpen(false)}
                >
                  Class bookings
                </Link>
                <Link
                  href="/member/pt-bookings"
                  className="block px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  role="menuitem"
                  onClick={() => setBookingsOpen(false)}
                >
                  PT bookings
                </Link>
              </div>,
              document.body
            )}
        </li>
        <li>{link("/member/workouts", "My Workouts", pathname?.startsWith("/member/workouts"))}</li>
        <li>{link("/member/macros", "My Macros", pathname?.startsWith("/member/macros"))}</li>
        <li>{link("/rec-leagues", "Rec Leagues", pathname?.startsWith("/rec-leagues"))}</li>
        <li className="pt-2 mt-2 border-t border-stone-500">
          <span className="block px-3 py-1 text-xs font-medium text-stone-600">Purchase</span>
        </li>
        <li>{link("/member/classes", "Browse Classes")}</li>
        <li>{link("/member/pt-sessions", "Browse PT Sessions")}</li>
        <li>{link("/member/class-packs", "Class Packs")}</li>
        <li>{link("/member/pt-packs", "PT Packs")}</li>
        <li>{link("/member/memberships", "Memberships")}</li>
        <li>{link("/member/cart", "Cart")}</li>
        {!isMember && (
          <li className="pt-2 mt-2 border-t border-stone-500">
            <Link href="/login" className="block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500" style={sidebarTextOutline}>
              Log in
            </Link>
          </li>
        )}
        {isMember && (
          <li className="pt-2 mt-2 border-t border-stone-500">
            <button
              type="button"
              onClick={onLogout}
              className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500"
              style={sidebarTextOutline}
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
          <Link href="/login" className="block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500" style={sidebarTextOutline}>
            Login
          </Link>
        </li>
      )}
      {isTrainer && (
        <li>{link("/trainer", "My schedule", pathname === "/trainer" || pathname?.startsWith("/trainer/"))}</li>
      )}
      {!isAdmin && <li>{link("/schedule", "Schedule", pathname === "/schedule" || pathname?.startsWith("/schedule/"))}</li>}
      {isAdmin && <li>{link("/master-schedule", "Master Schedule")}</li>}
      {isAdmin && <li>{link("/admin/trainers", "Trainers")}</li>}
      {isAdmin && <li>{link("/admin/create-workout-for-member", "Create Workout for Member")}</li>}
      {isAdmin && <li>{link("/admin/settings", "Settings")}</li>}
      {isAdmin && <li>{link("/admin/email-members", "Email all members")}</li>}
      {mainSections.map((s) => (
        <React.Fragment key={s.slug}>
          <li>{link(`/${s.slug}`, s.title, pathname === `/${s.slug}`)}</li>
          {s.slug === "members" && (
            <li ref={bookingsRef} className="relative">
              <button
                ref={bookingsButtonRef}
                type="button"
                onClick={() => setBookingsOpen((open) => !open)}
                className={`w-full text-left block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500 ${
                  isOnBookingsPage ? "bg-brand-500/20" : ""
                }`}
                style={sidebarTextOutline}
              >
                <span className="flex items-center justify-between gap-1">
                  Bookings
                  <svg
                    className={`w-4 h-4 shrink-0 transition-transform ${bookingsOpen ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
              {bookingsOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={bookingsDropdownRef}
                    className="fixed min-w-[10rem] py-1 rounded-lg border border-stone-200 bg-white shadow-lg z-[100]"
                    style={{ top: bookingsPosition.top, left: bookingsPosition.left, marginLeft: 4 }}
                    role="menu"
                  >
                    {bookingsSubs.map(({ slug, title }) => (
                      <Link
                        key={slug}
                        href={`/${slug}`}
                        className={`block px-3 py-2 text-sm font-medium ${
                          pathname === `/${slug}` ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                        }`}
                        role="menuitem"
                        onClick={() => setBookingsOpen(false)}
                      >
                        {title}
                      </Link>
                    ))}
                  </div>,
                  document.body
                )}
            </li>
          )}
          {s.slug === "members" && (
            <li ref={servicesRef} className="relative">
              <button
                ref={servicesButtonRef}
                type="button"
                onClick={() => setServicesOpen((open) => !open)}
                className={`w-full text-left block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500 ${
                  isOnServicesPage ? "bg-brand-500/20" : ""
                }`}
                style={sidebarTextOutline}
              >
                <span className="flex items-center justify-between gap-1">
                  Services
                  <svg
                    className={`w-4 h-4 shrink-0 transition-transform ${servicesOpen ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
              {servicesOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={servicesDropdownRef}
                    className="fixed min-w-[10rem] py-1 rounded-lg border border-stone-200 bg-white shadow-lg z-[100]"
                    style={{ top: servicesPosition.top, left: servicesPosition.left, marginLeft: 4 }}
                    role="menu"
                  >
                    {[
                      { href: "/membership-plans", label: "Membership Plans" },
                      { href: "/pt-sessions", label: "PT Sessions" },
                      { href: "/pt-packs", label: "PT Packs" },
                      { href: "/classes", label: "Classes" },
                      { href: "/class-packs", label: "Class Packs" },
                      { href: "/rec-leagues", label: "Rec Leagues" },
                    ].map(({ href, label }) => (
                      <Link
                        key={href}
                        href={href}
                        className={`block px-3 py-2 text-sm font-medium ${
                          pathname === href || pathname?.startsWith(href + "/")
                            ? "bg-brand-50 text-brand-800"
                            : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                        }`}
                        role="menuitem"
                        onClick={() => setServicesOpen(false)}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>,
                  document.body
                )}
            </li>
          )}
        </React.Fragment>
      ))}
      <li ref={reportsRef} className="relative">
        <button
          ref={reportsButtonRef}
          type="button"
          onClick={() => setReportsOpen((open) => !open)}
          className={`w-full text-left block px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500 ${
            isOnReportPage ? "bg-brand-500/20" : ""
          }`}
          style={sidebarTextOutline}
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
              <Link
                href="/admin/usage"
                className={`block px-3 py-2 text-sm font-medium ${
                  pathname === "/admin/usage" || pathname?.startsWith("/admin/usage/") ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
                role="menuitem"
                onClick={() => setReportsOpen(false)}
              >
                Usage tracking
              </Link>
            </div>,
            document.body
          )}
      </li>
      {isAdmin && (
        <>
          <li className="pt-2 mt-2 border-t border-stone-500">
            <span className="block px-3 py-1 text-xs font-medium text-stone-600">Member area</span>
          </li>
          <li>{link("/member", "Member home", pathname === "/member")}</li>
          <li>{link("/member/workouts", "My Workouts", pathname?.startsWith("/member/workouts"))}</li>
          <li>{link("/member/macros", "My Macros", pathname?.startsWith("/member/macros"))}</li>
          <li className="pt-2 mt-2 border-t border-stone-500">
            <button
              type="button"
              onClick={onLogout}
              className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-800 hover:bg-stone-500"
              style={sidebarTextOutline}
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
  // When an admin clicks Schedule from member nav, keep member nav so it doesn't feel like leaving member space.
  const showMemberNav = !isMember || inMemberArea || (isAdmin && pathname === "/schedule");

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
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-stone-400 shadow-xl flex flex-col overflow-hidden border-r border-stone-500">
            <div className="p-4 border-b border-stone-500 shrink-0">
              <Link href={logoHref} className="block rounded-lg overflow-hidden" onClick={() => setMobileMenuOpen(false)}>
                <img src="/Logo-w-gray.svg" alt={BRAND.name} className="w-full h-auto block" />
              </Link>
              {isMember && member && (
                <p className="text-xs text-stone-800 mt-1 truncate" style={sidebarTextOutline} title={member.email ?? undefined}>{member.name}</p>
              )}
            </div>
            <nav className="p-2 flex-1 overflow-y-auto">
              <NavList {...navProps} />
            </nav>
          </div>
        </>
      )}

      {/* Desktop: sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-stone-500 bg-stone-400 flex-col">
      <div className="p-4 border-b border-stone-500">
        <Link href={logoHref} className="block rounded-lg overflow-hidden" aria-label={BRAND.name}>
          <img src="/Logo-w-gray.svg" alt={BRAND.name} className="w-full h-auto block" />
        </Link>
        {isMember && member && (
          <p className="text-xs text-stone-800 mt-1 truncate" style={sidebarTextOutline} title={member.email ?? undefined}>{member.name}</p>
        )}
      </div>
      <nav className="p-2 flex-1 overflow-y-auto">
        <NavList {...navProps} />
      </nav>
    </aside>
    </>
  );
}
