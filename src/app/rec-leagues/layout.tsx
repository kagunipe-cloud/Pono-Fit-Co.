"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/branding";

const REC_NAV_BASE = [
  { href: "/rec-leagues/teams", label: "Teams" },
  { href: "/rec-leagues/schedule", label: "Schedule" },
  { href: "/rec-leagues/bracket", label: "Playoff Bracket" },
  { href: "/rec-leagues/register", label: "Register" },
] as const;

type Team = { id: number; name: string; created_by_member_id: string | null };

export default function RecLeaguesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [myTeamId, setMyTeamId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/rec-leagues/teams").then((r) => r.json()),
    ])
      .then(([me, teams]: [{ member_id?: string } | null, Team[]]) => {
        const memberId = me?.member_id;
        if (!memberId || !Array.isArray(teams)) return;
        const myTeam = teams.find((t) => t.created_by_member_id === memberId);
        setMyTeamId(myTeam?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const navItems = [
    ...(myTeamId != null ? [{ href: `/rec-leagues/teams/${myTeamId}` as const, label: "My Team" as const }] : []),
    ...REC_NAV_BASE,
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="text-sm text-stone-500 hover:text-stone-700"
        >
          ← Back to {BRAND.name}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-4">
        <h1 className="text-lg font-semibold text-stone-800 mr-4">Rec Leagues</h1>
        <nav className="flex gap-1" aria-label="Rec Leagues">
          {navItems.map(({ href, label }) => {
            const isActive = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${
                  isActive
                    ? "bg-brand-50 text-brand-800"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
