"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BracketGame = {
  id: string;
  team1_id?: number | null;
  team2_id?: number | null;
  winner_id?: number | null;
  team1_name?: string | null;
  team2_name?: string | null;
};
type BracketRound = { name: string; games: BracketGame[] };
type Bracket = { rounds: BracketRound[] };
type Team = { id: number; name: string };

type BracketData = {
  league_id: number;
  league_name: string;
  num_teams: number | null;
  bracket: Bracket | null;
  teams: Team[];
  updated_at?: string;
};

export default function RecLeaguesBracketPage() {
  const [leagues, setLeagues] = useState<{ id: number; name: string }[]>([]);
  const [leagueId, setLeagueId] = useState<string>("");
  const [data, setData] = useState<BracketData | null>(null);
  const [member, setMember] = useState<{ role?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editBracket, setEditBracket] = useState<Bracket | null>(null);
  const [numTeams, setNumTeams] = useState<number>(8);

  const isAdmin = member?.role === "Admin";

  useEffect(() => {
    fetch("/api/rec-leagues/leagues")
      .then((r) => r.json())
      .then((d) => setLeagues(Array.isArray(d) ? d : []));
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMember(d ?? null));
  }, []);

  useEffect(() => {
    if (!leagueId) {
      setData(null);
      setEditBracket(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/rec-leagues/bracket?league_id=${encodeURIComponent(leagueId)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error)))))
      .then((d: BracketData) => {
        setData(d);
        setEditBracket(d.bracket ? JSON.parse(JSON.stringify(d.bracket)) : null);
        if (d.num_teams) setNumTeams(d.num_teams);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load bracket");
        setData(null);
        setEditBracket(null);
      })
      .finally(() => setLoading(false));
  }, [leagueId]);

  async function handleInitialize() {
    if (!leagueId || !isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rec-leagues/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: parseInt(leagueId, 10), num_teams: numTeams }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create bracket");
      setEditBracket(json.bracket);
      setData((prev) => (prev ? { ...prev, num_teams: numTeams, bracket: json.bracket } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  function updateGame(roundIndex: number, gameIndex: number, field: "team1_id" | "team2_id" | "winner_id", value: number | null) {
    if (!editBracket) return;
    const rounds = [...editBracket.rounds];
    const games = [...rounds[roundIndex].games];
    const g = { ...games[gameIndex], [field]: value };
    games[gameIndex] = g;
    rounds[roundIndex] = { ...rounds[roundIndex], games };
    setEditBracket({ rounds });
  }

  async function handleSave() {
    if (!leagueId || !editBracket || !isAdmin) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rec-leagues/bracket", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: parseInt(leagueId, 10), bracket: editBracket }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      const refetch = await fetch(`/api/rec-leagues/bracket?league_id=${encodeURIComponent(leagueId)}`);
      const next = await refetch.json();
      if (refetch.ok && next.bracket) {
        setData((prev) => (prev ? { ...prev, bracket: next.bracket, updated_at: next.updated_at } : null));
        setEditBracket(JSON.parse(JSON.stringify(next.bracket)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const bracket = editBracket ?? data?.bracket;
  const teams = data?.teams ?? [];

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-600">League</span>
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
          >
            <option value="">Select league…</option>
            {leagues.map((l) => (
              <option key={l.id} value={String(l.id)}>{l.name}</option>
            ))}
          </select>
        </label>
        {isAdmin && data && (
          <>
            <label className="flex items-center gap-2">
              <span className="text-sm font-medium text-stone-600">Teams</span>
              <select
                value={numTeams}
                onChange={(e) => setNumTeams(Number(e.target.value))}
                disabled={!!data.bracket}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
              >
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16</option>
              </select>
            </label>
            {!data.bracket ? (
              <button
                type="button"
                onClick={handleInitialize}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create bracket"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-stone-700 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading && <p className="text-stone-500 text-sm">Loading…</p>}
      {!loading && leagueId && !data && !error && <p className="text-stone-500 text-sm">No data.</p>}
      {!loading && data && !bracket && (
        <p className="text-stone-500 text-sm">
          No bracket yet. {isAdmin ? "Choose number of teams and click Create bracket." : "Check back later."}
        </p>
      )}

      {!loading && data && bracket && (
        <div className="overflow-x-auto">
          <div className="flex gap-8 min-w-max py-4">
            {bracket.rounds.map((round, roundIndex) => (
              <div key={round.name} className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-stone-700 sticky top-0 bg-white py-1">{round.name}</h3>
                <div
                  className="flex flex-col justify-around gap-2"
                  style={{ minHeight: round.games.length * 80 + (round.games.length - 1) * 24 }}
                >
                  {round.games.map((game, gameIndex) => (
                    <div
                      key={game.id}
                      className="border border-stone-200 rounded-lg bg-white shadow-sm overflow-hidden min-w-[200px]"
                    >
                      <div className="p-2 space-y-0.5">
                        {/* Team 1 */}
                        <div
                          className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${
                            game.winner_id === game.team1_id ? "bg-brand-50 font-medium" : ""
                          }`}
                        >
                          {isAdmin && roundIndex === 0 ? (
                            <select
                              value={game.team1_id ?? ""}
                              onChange={(e) => updateGame(roundIndex, gameIndex, "team1_id", e.target.value ? Number(e.target.value) : null)}
                              className="flex-1 min-w-0 text-sm border-0 bg-transparent p-0"
                            >
                              <option value="">—</option>
                              {teams.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm truncate">{game.team1_name ?? "—"}</span>
                          )}
                        </div>
                        <div className="text-stone-300 text-center text-xs">vs</div>
                        {/* Team 2 */}
                        <div
                          className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${
                            game.winner_id === game.team2_id ? "bg-brand-50 font-medium" : ""
                          }`}
                        >
                          {isAdmin && roundIndex === 0 ? (
                            <select
                              value={game.team2_id ?? ""}
                              onChange={(e) => updateGame(roundIndex, gameIndex, "team2_id", e.target.value ? Number(e.target.value) : null)}
                              className="flex-1 min-w-0 text-sm border-0 bg-transparent p-0"
                            >
                              <option value="">—</option>
                              {teams.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm truncate">{game.team2_name ?? "—"}</span>
                          )}
                        </div>
                        {/* Winner (admin) */}
                        {isAdmin && (game.team1_id != null || game.team2_id != null) && (
                          <div className="pt-1 mt-1 border-t border-stone-100">
                            <label className="text-xs text-stone-500 block mb-0.5">Winner</label>
                            <select
                              value={game.winner_id ?? ""}
                              onChange={(e) => updateGame(roundIndex, gameIndex, "winner_id", e.target.value ? Number(e.target.value) : null)}
                              className="w-full text-xs rounded border border-stone-200 px-2 py-1"
                            >
                              <option value="">—</option>
                              {game.team1_id != null && (
                                <option value={game.team1_id}>{teams.find((t) => t.id === game.team1_id)?.name ?? `#${game.team1_id}`}</option>
                              )}
                              {game.team2_id != null && (
                                <option value={game.team2_id}>{teams.find((t) => t.id === game.team2_id)?.name ?? `#${game.team2_id}`}</option>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!leagueId && !loading && (
        <p className="text-stone-500 text-sm">Select a league to view or edit the playoff bracket.</p>
      )}
    </div>
  );
}
