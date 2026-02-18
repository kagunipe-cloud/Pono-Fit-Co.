"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Team = {
  id: number;
  name: string;
  created_at: string;
  created_by_member_id: string | null;
  league_names?: string[];
};

type League = { id: number; name: string };

export default function RecLeaguesTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [member, setMember] = useState<{ member_id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/rec-leagues/teams").then((r) => r.json()),
      fetch("/api/rec-leagues/leagues").then((r) => r.json()),
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([teamsData, leaguesData, memberData]) => {
        setTeams(Array.isArray(teamsData) ? teamsData : []);
        setLeagues(Array.isArray(leaguesData) ? leaguesData : []);
        setMember(memberData ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleEnroll(teamId: number, leagueId: number) {
    setEnrolling(teamId);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${teamId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      if (res.ok) {
        const list = await fetch("/api/rec-leagues/teams").then((r) => r.json());
        setTeams(Array.isArray(list) ? list : []);
      }
    } finally {
      setEnrolling(null);
    }
  }

  async function handleUnenroll(teamId: number, leagueId: number) {
    setEnrolling(teamId);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${teamId}/unenroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      if (res.ok) {
        const list = await fetch("/api/rec-leagues/teams").then((r) => r.json());
        setTeams(Array.isArray(list) ? list : []);
      }
    } finally {
      setEnrolling(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <p className="text-stone-500 text-sm">Loading teams…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-stone-800 mb-2">Teams</h2>
      <p className="text-stone-600 text-sm mb-6">
        All teams are listed here. Team admins can enroll in Volleyball and/or Kickball (no gym membership required). Roster and invite links coming next.
      </p>
      {teams.length === 0 ? (
        <div className="bg-stone-100 rounded-xl p-6 text-center text-stone-500 text-sm">
          No teams yet. Create a team from <Link href="/rec-leagues/register" className="text-brand-600 hover:underline">Register</Link> (coming soon), then enroll in one or both leagues here.
        </div>
      ) : (
        <ul className="space-y-4">
          {teams.map((t) => {
            const isMyTeam = member && t.created_by_member_id === member.member_id;
            const enrolledNames = t.league_names ?? [];
            return (
              <li
                key={t.id}
                className="bg-white rounded-xl border border-stone-200 p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="font-medium text-stone-800">
                    <Link href={`/rec-leagues/teams/${t.id}`} className="hover:text-brand-600 hover:underline">
                      {t.name}
                    </Link>
                  </p>
                  {enrolledNames.length > 0 && (
                    <p className="text-xs text-stone-500 mt-1">
                      Enrolled: {enrolledNames.join(", ")}
                    </p>
                  )}
                </div>
                {isMyTeam && (
                  <div className="flex flex-wrap gap-2">
                    {leagues.map((l) => {
                      const enrolled = enrolledNames.includes(l.name);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          disabled={enrolling === t.id}
                          onClick={() =>
                            enrolled
                              ? handleUnenroll(t.id, l.id)
                              : handleEnroll(t.id, l.id)
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            enrolled
                              ? "bg-stone-200 text-stone-700 hover:bg-stone-300"
                              : "bg-brand-100 text-brand-800 hover:bg-brand-200"
                          } disabled:opacity-50`}
                        >
                          {enrolled ? `${l.name} ✓` : `+ ${l.name}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
