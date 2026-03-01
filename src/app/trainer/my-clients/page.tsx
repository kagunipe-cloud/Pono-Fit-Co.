"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ClientRow = {
  id: number;
  trainer_member_id: string;
  client_member_id: string;
  notes: string | null;
  created_at: string | null;
  trainer_name: string;
  client_name: string;
  client_email: string | null;
};
type Trainer = { member_id: string; display_name: string };
type Member = { member_id: string; first_name?: string | null; last_name?: string | null; email?: string | null };

export default function MyClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filterTrainerId, setFilterTrainerId] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [addTrainerId, setAddTrainerId] = useState("");
  const [addClientId, setAddClientId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function fetchClients() {
    const url = filterTrainerId
      ? `/api/trainer/clients?trainer_member_id=${encodeURIComponent(filterTrainerId)}`
      : "/api/trainer/clients";
    fetch(url)
      .then((r) => {
        if (r.status === 401) throw new Error("Unauthorized");
        return r.json();
      })
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchClients();
  }, [filterTrainerId]);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { role?: string } | null) => setIsAdmin(me?.role === "Admin"))
      .catch(() => {});
    fetch("/api/trainers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setTrainers(Array.isArray(list) ? list : []))
      .catch(() => {});
    fetch("/api/members")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setMembers(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!addClientId.trim()) {
      setAddError("Select a client.");
      return;
    }
    setAdding(true);
    const body: { client_member_id: string; trainer_member_id?: string } = { client_member_id: addClientId.trim() };
    if (isAdmin && addTrainerId.trim()) body.trainer_member_id = addTrainerId.trim();
    fetch("/api/trainer/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (ok) {
          setShowAdd(false);
          setAddClientId("");
          setAddTrainerId("");
          fetchClients();
        } else {
          setAddError((data as { error?: string }).error ?? "Failed to add client");
        }
      })
      .finally(() => setAdding(false));
  }

  function startEdit(row: ClientRow) {
    setEditingId(row.id);
    setEditNotes(row.notes ?? "");
  }

  function saveEdit() {
    if (editingId == null) return;
    setSavingEdit(true);
    fetch(`/api/trainer/clients/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: editNotes }),
    })
      .then((r) => {
        if (r.ok) {
          setEditingId(null);
          fetchClients();
        }
      })
      .finally(() => setSavingEdit(false));
  }

  function remove(id: number) {
    if (!confirm("Remove this client from the list?")) return;
    setDeletingId(id);
    fetch(`/api/trainer/clients/${id}`, { method: "DELETE" })
      .then((r) => {
        if (r.ok) fetchClients();
      })
      .finally(() => setDeletingId(null));
  }

  if (loading) return <div className="p-6 text-stone-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/trainer" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">← My Schedule</Link>
        <h1 className="text-2xl font-bold text-stone-800">My Clients</h1>
        <p className="text-stone-500 text-sm mt-1">
          {isAdmin ? "All PT clients for the gym. Filter by trainer or add a client to any trainer." : "Clients who have booked PT with you (or were added here) appear below."}
        </p>
      </div>

      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-stone-600">Trainer</label>
          <select
            value={filterTrainerId}
            onChange={(e) => setFilterTrainerId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-stone-200"
          >
            <option value="">All trainers</option>
            {trainers.map((t) => (
              <option key={t.member_id} value={t.member_id}>{t.display_name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add Client
        </button>
      </div>

      {clients.length === 0 ? (
        <p className="text-stone-500">No clients yet. Add a client above, or they will appear here when they book a PT session with you.</p>
      ) : (
        <ul className="space-y-2">
          {clients.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-stone-200 bg-white">
              <div className="min-w-0">
                <span className="font-medium text-stone-800">{row.client_name}</span>
                {row.client_email && <span className="ml-2 text-sm text-stone-500">{row.client_email}</span>}
                {isAdmin && <span className="ml-2 text-xs text-stone-400">→ {row.trainer_name}</span>}
                {editingId === row.id ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes"
                      className="flex-1 min-w-0 px-2 py-1.5 rounded border border-stone-200 text-sm"
                    />
                    <button type="button" onClick={saveEdit} disabled={savingEdit} className="px-2 py-1.5 rounded bg-brand-600 text-white text-sm disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="px-2 py-1.5 rounded border border-stone-200 text-sm">Cancel</button>
                  </div>
                ) : (
                  (row.notes && <p className="text-sm text-stone-600 mt-0.5">{row.notes}</p>) || null
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editingId !== row.id && (
                  <>
                    <Link href={`/trainer/my-clients/${row.client_member_id}`} className="text-sm text-brand-600 hover:underline">Dashboard</Link>
                    <Link href={`/members/${row.client_member_id}`} className="text-sm text-brand-600 hover:underline">View</Link>
                    <button type="button" onClick={() => startEdit(row)} className="text-sm text-stone-600 hover:underline">Edit</button>
                    <button type="button" onClick={() => remove(row.id)} disabled={deletingId === row.id} className="text-sm text-red-600 hover:underline disabled:opacity-50">Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <>
          <div className="fixed inset-0 bg-stone-900/50 z-40" aria-hidden onClick={() => setShowAdd(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-stone-800 mb-4">Add Client</h2>
            {addError && <p className="mb-3 text-sm text-red-600">{addError}</p>}
            <form onSubmit={handleAdd} className="space-y-4">
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Trainer</label>
                  <select
                    value={addTrainerId}
                    onChange={(e) => setAddTrainerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    required={isAdmin}
                  >
                    <option value="">Select trainer</option>
                    {trainers.map((t) => (
                      <option key={t.member_id} value={t.member_id}>{t.display_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Client (member)</label>
                <select
                  value={addClientId}
                  onChange={(e) => setAddClientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                  required
                >
                  <option value="">Select member</option>
                  {members.map((m) => (
                    <option key={m.member_id} value={m.member_id}>
                      {[m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.member_id} {m.email ? `(${m.email})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={adding} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
                  {adding ? "Adding…" : "Add"}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
