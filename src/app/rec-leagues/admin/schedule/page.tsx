"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type League = { id: number; name: string };
type Team = { id: number; name: string };

export default function RecLeaguesAdminSchedulePage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [member, setMember] = useState<{ role?: string } | null>(null);
  const [form, setForm] = useState({
    league_id: "",
    game_date: "",
    game_time: "",
    home_team_id: "",
    away_team_id: "",
    location: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setMember(data ?? null);
        if (data?.role !== "Admin") return;
        return Promise.all([
          fetch("/api/rec-leagues/leagues").then((r) => r.json()),
        ]).then(([leaguesData]) => {
          setLeagues(Array.isArray(leaguesData) ? leaguesData : []);
        });
      });
  }, []);

  useEffect(() => {
    if (!form.league_id || member?.role !== "Admin") return;
    fetch(`/api/rec-leagues/teams?league_id=${form.league_id}`)
      .then((r) => r.json())
      .then((data) => setTeams(Array.isArray(data) ? data : []));
  }, [form.league_id, member?.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/rec-leagues/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: parseInt(form.league_id, 10),
          home_team_id: parseInt(form.home_team_id, 10),
          away_team_id: parseInt(form.away_team_id, 10),
          game_date: form.game_date,
          game_time: form.game_time || null,
          location: form.location || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create game");
      router.push("/rec-leagues/schedule");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (member !== null && member?.role !== "Admin") {
    return (
      <div className="max-w-xl">
        <p className="text-red-600">Only the app admin can create the schedule.</p>
        <Link href="/rec-leagues/schedule" className="text-brand-600 hover:underline text-sm mt-2 inline-block">
          ← Back to schedule
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <Link href="/rec-leagues/schedule" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Back to schedule
      </Link>
      <h2 className="text-xl font-bold text-stone-800 mb-2">Add Game</h2>
      <p className="text-stone-600 text-sm mb-6">
        Choose league, date, time, and which two teams play. Only teams enrolled in that league appear.
      </p>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-4">
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">League</label>
          <select
            required
            value={form.league_id}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                league_id: e.target.value,
                home_team_id: "",
                away_team_id: "",
              }))
            }
            className="w-full rounded-lg border border-stone-200 px-3 py-2"
          >
            <option value="">Select league</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Date</label>
            <input
              type="date"
              required
              value={form.game_date}
              onChange={(e) => setForm((f) => ({ ...f, game_date: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Time (optional)</label>
            <input
              type="time"
              value={form.game_time}
              onChange={(e) => setForm((f) => ({ ...f, game_time: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 px-3 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Home team</label>
          <select
            required
            value={form.home_team_id}
            onChange={(e) => setForm((f) => ({ ...f, home_team_id: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 px-3 py-2"
            disabled={!form.league_id}
          >
            <option value="">Select team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {form.league_id && teams.length === 0 && (
            <p className="text-xs text-stone-500 mt-1">No teams enrolled in this league yet.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Away team</label>
          <select
            required
            value={form.away_team_id}
            onChange={(e) => setForm((f) => ({ ...f, away_team_id: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 px-3 py-2"
            disabled={!form.league_id}
          >
            <option value="">Select team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Location (optional)</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="e.g. Main gym"
            className="w-full rounded-lg border border-stone-200 px-3 py-2"
          />
        </div>
        <button
          data-dumbbell-btn
          type="submit"
          disabled={submitting || !form.league_id || !form.home_team_id || !form.away_team_id || !form.game_date}
          className="px-4 py-2.5 rounded-lg font-medium disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add Game"}
        </button>
      </form>
    </div>
  );
}
