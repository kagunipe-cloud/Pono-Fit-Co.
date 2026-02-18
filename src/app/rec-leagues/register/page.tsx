"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RecLeaguesRegisterPage() {
  const router = useRouter();
  const [member, setMember] = useState<{ member_id: string } | null | undefined>(undefined);
  const [teamName, setTeamName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMember(data ?? null));
  }, []);

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = teamName.trim();
    if (!name) {
      setError("Enter a team name.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/rec-leagues/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "same-origin",
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        setError(res.status === 401 ? "You’re not signed in. Sign in and try again." : `Request failed (${res.status}). Try again.`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}). Try again.`);
        return;
      }
      const teamId = data?.id;
      router.push(teamId ? `/rec-leagues/teams/${teamId}` : "/rec-leagues/teams");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-stone-800 mb-2">Register</h2>
      <p className="text-stone-600 text-sm mb-6">
        Create a new team (you’ll be the team admin for that team only) or join a team using an invite link from your captain. You’ll need to sign a waiver to become active.
      </p>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <h3 className="font-medium text-stone-800 mb-2">Create a Team</h3>
        <p className="text-stone-500 text-sm mb-4">
          After creating your team, go to <Link href="/rec-leagues/teams" className="text-brand-600 hover:underline">Teams</Link> to enroll in Volleyball and/or Kickball. You can add roster members and invite links later.
        </p>
        {member === undefined && (
          <p className="text-stone-500 text-sm">Checking sign-in…</p>
        )}
        {member === null && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mb-4">
            Sign in to create a team.{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Member login
            </Link>
          </p>
        )}
        {member !== null && member !== undefined && (
          <form onSubmit={handleCreateTeam} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="team_name" className="block text-sm font-medium text-stone-700 mb-1">
                Team name
              </label>
              <input
                id="team_name"
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Spike Squad"
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
                required
              />
            </div>
            <button
              data-dumbbell-btn
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 rounded-lg font-medium disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create team"}
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 text-stone-500 text-sm">
        <p className="font-medium text-stone-700 mb-1">Join a Team</p>
        <p>Use the invite link from your captain to join their team. Invite flow and waiver coming soon.</p>
      </div>
    </div>
  );
}
