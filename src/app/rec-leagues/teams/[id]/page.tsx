"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type RosterMember = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  role: string;
  waiver_signed_at: string | null;
};

type Team = {
  id: number;
  name: string;
  created_by_member_id: string | null;
  league_ids: number[];
  roster: RosterMember[];
};

export default function RecLeaguesTeamDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [team, setTeam] = useState<Team | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [sendWaiversMsg, setSendWaiversMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ first_name: "", last_name: "", email: "" });
  const [savingId, setSavingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/rec-leagues/teams/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([teamData, memberData]) => {
        setTeam(teamData ?? null);
        setMemberId(memberData?.member_id ?? null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const isAdmin = team && memberId && team.created_by_member_id === memberId;
  const allWaiversSigned = team && team.roster.length > 0 && team.roster.every((m) => m.waiver_signed_at);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const email = form.email.trim().toLowerCase();
    if (!email) {
      setAddError("Email required.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name.trim() || null,
          last_name: form.last_name.trim() || null,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      setForm({ first_name: "", last_name: "", email: "" });
      const updated = await fetch(`/api/rec-leagues/teams/${id}`).then((r) => r.json());
      setTeam(updated);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveMember(rosterMemberId: number) {
    setSavingId(rosterMemberId);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${id}/members/${rosterMemberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: editForm.first_name.trim() || null,
          last_name: editForm.last_name.trim() || null,
          email: editForm.email.trim().toLowerCase(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      setEditingId(null);
      const updated = await fetch(`/api/rec-leagues/teams/${id}`).then((r) => r.json());
      setTeam(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setSavingId(null);
    }
  }

  async function handleRemoveMember(rosterMemberId: number) {
    if (!confirm("Remove this player from the team?")) return;
    setRemovingId(rosterMemberId);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${id}/members/${rosterMemberId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      const updated = await fetch(`/api/rec-leagues/teams/${id}`).then((r) => r.json());
      setTeam(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  }

  function startEditing(m: RosterMember) {
    setEditingId(m.id);
    setEditForm({
      first_name: m.first_name ?? "",
      last_name: m.last_name ?? "",
      email: m.email ?? "",
    });
  }

  async function handleSendWaivers() {
    setSendWaiversMsg(null);
    try {
      const res = await fetch(`/api/rec-leagues/teams/${id}/send-waivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        setSendWaiversMsg(data.message ?? "Done.");
        const updated = await fetch(`/api/rec-leagues/teams/${id}`).then((r) => r.json());
        setTeam(updated);
      } else {
        setSendWaiversMsg(data.error ?? "Failed.");
      }
    } catch {
      setSendWaiversMsg("Something went wrong.");
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <p className="text-stone-500 text-sm">Loading…</p>
      </div>
    );
  }
  if (!team) {
    return (
      <div className="max-w-2xl">
        <p className="text-red-600">Team not found.</p>
        <Link href="/rec-leagues/teams" className="text-brand-600 hover:underline text-sm mt-2 inline-block">
          ← Back to teams
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/rec-leagues/teams" className="text-stone-500 hover:text-stone-700 text-sm">
          ← All teams
        </Link>
      </div>
      <h2 className="text-xl font-bold text-stone-800">{team.name}</h2>
      {isAdmin && (
        <p className="text-stone-500 text-sm">You’re the team admin. Add members below and send waivers when ready.</p>
      )}

      {/* Roster */}
      <div>
        <h3 className="font-medium text-stone-800 mb-2">Roster</h3>
        {team.roster.length === 0 ? (
          <p className="text-stone-500 text-sm">No members yet. Add one below.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <th className="text-left py-2 px-3 font-medium text-stone-700">First Name</th>
                  <th className="text-left py-2 px-3 font-medium text-stone-700">Last Name</th>
                  <th className="text-left py-2 px-3 font-medium text-stone-700">Email</th>
                  <th className="text-left py-2 px-3 font-medium text-stone-700 w-24">Waiver Signed</th>
                  {isAdmin && <th className="text-left py-2 px-3 font-medium text-stone-700 w-28">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {team.roster.map((m) => (
                  <tr key={m.id} className="border-b border-stone-100 last:border-0">
                    {editingId === m.id ? (
                      <>
                        <td className="py-2 px-3">
                          <input
                            value={editForm.first_name}
                            onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                            className="rounded border border-stone-200 px-2 py-1 text-sm w-24"
                            placeholder="First"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            value={editForm.last_name}
                            onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                            className="rounded border border-stone-200 px-2 py-1 text-sm w-24"
                            placeholder="Last"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                            className="rounded border border-stone-200 px-2 py-1 text-sm w-40"
                            placeholder="Email"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={Boolean(m.waiver_signed_at)}
                            disabled
                            readOnly
                            className="rounded border-stone-300 text-brand-600"
                          />
                        </td>
                        {isAdmin && (
                          <td className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => handleSaveMember(m.id)}
                              disabled={savingId !== null}
                              className="text-brand-600 hover:underline text-xs font-medium disabled:opacity-50 mr-2"
                            >
                              {savingId === m.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="text-stone-500 hover:underline text-xs"
                            >
                              Cancel
                            </button>
                          </td>
                        )}
                      </>
                    ) : (
                      <>
                        <td className="py-2 px-3 text-stone-800">{m.first_name || "—"}</td>
                        <td className="py-2 px-3 text-stone-800">{m.last_name || "—"}</td>
                        <td className="py-2 px-3 text-stone-800">{m.email}</td>
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={Boolean(m.waiver_signed_at)}
                            disabled
                            readOnly
                            className="rounded border-stone-300 text-brand-600"
                          />
                        </td>
                        {isAdmin && (
                          <td className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => startEditing(m)}
                              className="text-brand-600 hover:underline text-xs font-medium mr-2"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(m.id)}
                              disabled={removingId !== null}
                              className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50"
                            >
                              {removingId === m.id ? "…" : "Remove"}
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && (
        <>
          <div>
            <h3 className="font-medium text-stone-800 mb-2">Add Member</h3>
            <form onSubmit={handleAddMember} className="flex flex-wrap gap-2 items-end">
              <input
                type="text"
                placeholder="First name"
                value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm w-28"
              />
              <input
                type="text"
                placeholder="Last name"
                value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm w-28"
              />
              <input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm w-48"
                required
              />
              <button
                data-dumbbell-btn
                type="submit"
                disabled={adding}
                className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </form>
            {addError && (
              <p className="text-red-600 text-sm mt-2">{addError}</p>
            )}
          </div>

          <div>
            <button
              data-dumbbell-btn
              type="button"
              onClick={handleSendWaivers}
              disabled={allWaiversSigned ?? false}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${allWaiversSigned ? "opacity-60 cursor-not-allowed bg-stone-200 text-stone-500" : ""}`}
            >
              Send Waivers
            </button>
            {sendWaiversMsg && (
              <p className="text-stone-600 text-sm mt-2">{sendWaiversMsg}</p>
            )}
            {allWaiversSigned && (
              <p className="text-stone-500 text-sm mt-2">All team members have signed waiver.</p>
            )}
          </div>
        </>
      )}

      {!isAdmin && (
        <p className="text-stone-500 text-sm">Enroll this team in leagues from the <Link href="/rec-leagues/teams" className="text-brand-600 hover:underline">Teams</Link> page if you’re the admin.</p>
      )}
    </div>
  );
}
