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

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [member, setMember] = useState<MemberMe | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMember(data ?? null))
      .catch(() => setMember(null));
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/member-logout", { method: "POST" });
    setMember(null);
    router.push("/");
    router.refresh();
  }

  const isMember = member !== undefined && member !== null;
  const isAdmin = member?.role === "Admin";
  const inMemberArea = pathname === "/member" || pathname?.startsWith("/member/");
  const showMemberNav = inMemberArea;

  return (
    <aside className="w-56 shrink-0 border-r border-stone-200 bg-white flex flex-col">
      <div className="p-4 border-b border-stone-100">
        <Link
          href={showMemberNav ? "/member" : "/"}
          className="block rounded-lg bg-white overflow-hidden"
          aria-label={BRAND.name}
        >
          <img src="/Logo-w-gray.svg" alt={BRAND.name} className="w-full h-auto block" />
        </Link>
        {isMember && (
          <p className="text-xs text-stone-500 mt-1 truncate" title={member.email ?? undefined}>
            {member.name}
          </p>
        )}
      </div>
      <nav className="p-2 flex-1 overflow-y-auto">
        <ul className="space-y-0.5">
          {showMemberNav ? (
            <>
              <li>
                <Link
                  href="/member"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href="/member/membership"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/membership"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  My Membership
                </Link>
              </li>
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
              <li>
                <Link
                  href="/member/class-bookings"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/class-bookings"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  My Class Bookings
                </Link>
              </li>
              <li>
                <Link
                  href="/member/pt-bookings"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/pt-bookings"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  My PT Bookings
                </Link>
              </li>
              <li>
                <Link
                  href="/member/workouts"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/workouts" || pathname?.startsWith("/member/workouts/")
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Workouts
                </Link>
              </li>
              <li>
                <Link
                  href="/member/macros"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/macros" || pathname?.startsWith("/member/macros/")
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Macros
                </Link>
              </li>
              <li>
                <Link
                  href="/rec-leagues"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname?.startsWith("/rec-leagues")
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Rec Leagues
                </Link>
              </li>
              <li className="pt-2 mt-2 border-t border-stone-100">
                <span className="block px-3 py-1 text-xs font-medium text-stone-400">Purchase</span>
              </li>
              <li>
                <Link
                  href="/member/classes"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/classes"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Browse Classes
                </Link>
              </li>
              <li>
                <Link
                  href="/member/pt-sessions"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/pt-sessions"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Browse PT Sessions
                </Link>
              </li>
              <li>
                <Link
                  href="/member/class-packs"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/class-packs"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Class Packs
                </Link>
              </li>
              <li>
                <Link
                  href="/member/pt-packs"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/pt-packs"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  PT Packs
                </Link>
              </li>
              <li>
                <Link
                  href="/member/memberships"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/memberships"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Memberships
                </Link>
              </li>
              <li>
                <Link
                  href="/member/cart"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/member/cart"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Cart
                </Link>
              </li>
              {isMember && (
                <li className="pt-2 mt-2 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  >
                    Log Out
                  </button>
                </li>
              )}
            </>
          ) : (
            <>
              <li>
                <Link
                  href="/"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    pathname === "/"
                      ? "bg-brand-50 text-brand-800"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  Home
                </Link>
              </li>
              {!isMember && (
                <li>
                  <Link
                    href="/login"
                    className="block px-3 py-2 rounded-lg text-sm font-medium text-brand-600 hover:bg-brand-50"
                  >
                    Login
                  </Link>
                </li>
              )}
              <li>
                <Link href="/schedule" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/schedule" || pathname?.startsWith("/schedule/") ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Schedule</Link>
              </li>
              <li>
                <Link href="/rec-leagues" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname?.startsWith("/rec-leagues") ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Rec Leagues</Link>
              </li>
              {isAdmin && (
                <li>
                  <Link href="/master-schedule" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/master-schedule" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Master Schedule</Link>
                </li>
              )}
              {isAdmin && (
                <li>
                  <Link href="/admin/create-workout-for-member" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/admin/create-workout-for-member" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Create Workout for Member</Link>
                </li>
              )}
              {isAdmin && (
                <li>
                  <Link href="/exercises" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/exercises" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Exercises</Link>
                </li>
              )}
              {isAdmin && (
                <li>
                  <Link href="/macros" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/macros" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Macros</Link>
                </li>
              )}
              {isAdmin && (
                <li>
                  <Link href="/admin/backup" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/admin/backup" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Backup &amp; Restore</Link>
                </li>
              )}
              <li>
                <Link href="/class-packs" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/class-packs" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>Class Packs</Link>
              </li>
              <li>
                <Link href="/pt-packs" className={`block px-3 py-2 rounded-lg text-sm font-medium ${pathname === "/pt-packs" ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>PT Packs</Link>
              </li>
              {SECTIONS.map((s) => {
                const href = `/${s.slug}`;
                const isActive = pathname === href;
                return (
                  <li key={s.slug}>
                    <Link
                      href={href}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        isActive
                          ? "bg-brand-50 text-brand-800"
                          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      }`}
                    >
                      {s.title}
                    </Link>
                  </li>
                );
              })}
              {isAdmin && (
                <>
                  <li className="pt-2 mt-2 border-t border-stone-100">
                    <span className="block px-3 py-1 text-xs font-medium text-stone-400">Member area</span>
                  </li>
                  <li>
                    <Link
                      href="/member"
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname === "/member"
                          ? "bg-brand-50 text-brand-800"
                          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      }`}
                    >
                      Member home
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/member/workouts"
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith("/member/workouts")
                          ? "bg-brand-50 text-brand-800"
                          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      }`}
                    >
                      My Workouts
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/member/macros"
                      className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                        pathname?.startsWith("/member/macros")
                          ? "bg-brand-50 text-brand-800"
                          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                      }`}
                    >
                      My Macros
                    </Link>
                  </li>
                  <li className="pt-2 mt-2 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                    >
                      Log Out
                    </button>
                  </li>
                </>
              )}
            </>
          )}
        </ul>
      </nav>
    </aside>
  );
}
