"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateOnlyInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/contexts/SettingsContext";

type Game = {
  id: number;
  league_id: number;
  league_name: string;
  home_team_name: string;
  away_team_name: string;
  game_date: string;
  game_time: string | null;
  location: string | null;
};

type MemberMe = { role?: string | null } | null;

export default function RecLeaguesSchedulePage() {
  const tz = useAppTimezone();
  const [games, setGames] = useState<Game[]>([]);
  const [leagueFilter, setLeagueFilter] = useState<string>("");
  const [leagues, setLeagues] = useState<{ id: number; name: string }[]>([]);
  const [member, setMember] = useState<MemberMe | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/rec-leagues/games").then((r) => r.json()),
      fetch("/api/rec-leagues/leagues").then((r) => r.json()),
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([gamesData, leaguesData, memberData]) => {
        setGames(Array.isArray(gamesData) ? gamesData : []);
        setLeagues(Array.isArray(leaguesData) ? leaguesData : []);
        setMember(memberData ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const isAdmin = member && (member as { role?: string }).role === "Admin";
  const filtered = leagueFilter
    ? games.filter((g) => String(g.league_id) === leagueFilter)
    : games;

  const byDate = filtered.reduce((acc, g) => {
    const d = g.game_date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(g);
    return acc;
  }, {} as Record<string, Game[]>);
  const sortedDates = Object.keys(byDate).sort();

  if (loading) {
    return (
      <div className="max-w-2xl">
        <p className="text-stone-500 text-sm">Loading schedule…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h2 className="text-xl font-bold text-stone-800">Schedule</h2>
        {isAdmin && (
          <Link
            href="/rec-leagues/admin/schedule"
            data-dumbbell-btn
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
          >
            Add Game
          </Link>
        )}
      </div>
      <p className="text-stone-600 text-sm mb-4">
        Games and events for all rec leagues. Visible to everyone.
      </p>
      {leagues.length > 0 && (
        <div className="mb-4">
          <label className="text-sm font-medium text-stone-700 mr-2">League:</label>
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm"
          >
            <option value="">All</option>
            {leagues.map((l) => (
              <option key={l.id} value={String(l.id)}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {sortedDates.length === 0 ? (
        <div className="bg-stone-100 rounded-xl p-6 text-center text-stone-500 text-sm">
          No games yet.
          {isAdmin && (
            <p className="mt-2">
              <Link href="/rec-leagues/admin/schedule" className="text-brand-600 hover:underline">
                Add a Game
              </Link>
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-6">
          {sortedDates.map((date) => (
            <li key={date}>
              <p className="text-sm font-medium text-stone-500 mb-2">
                {formatDateOnlyInAppTz(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, tz)}
              </p>
              <ul className="space-y-2">
                {byDate[date].map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-baseline gap-2 py-2 border-b border-stone-100 last:border-0"
                  >
                    <span className="text-xs text-stone-400">{g.league_name}</span>
                    <span className="font-medium text-stone-800">
                      {g.home_team_name ?? "TBD"} vs {g.away_team_name ?? "TBD"}
                    </span>
                    {g.game_time && (
                      <span className="text-sm text-stone-500">{g.game_time}</span>
                    )}
                    {g.location && (
                      <span className="text-sm text-stone-500">@ {g.location}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
