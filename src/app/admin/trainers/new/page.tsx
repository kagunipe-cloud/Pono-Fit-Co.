"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Member = { member_id: string; first_name?: string | null; last_name?: string | null; email?: string | null; role?: string | null };

type Trainer = { member_id: string; display_name: string };

export default function NewTrainerPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [useExisting, setUseExisting] = useState(true);
  const [existingId, setExistingId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [waiverAgreedAt, setWaiverAgreedAt] = useState("");
  const [form1099At, setForm1099At] = useState("");
  const [formI9At, setFormI9At] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/members").then((r) => r.json()),
      fetch("/api/trainers").then((r) => r.json()),
    ])
      .then(([membersData, trainersData]) => {
        setMembers(Array.isArray(membersData) ? membersData : []);
        setTrainers(Array.isArray(trainersData) ? trainersData : []);
      })
      .catch(() => {});
  }, []);

  const trainerMemberIds = new Set(trainers.map((t) => t.member_id));
  const candidates = members.filter((m) => !trainerMemberIds.has(m.member_id));
  const selectedMember = existingId ? members.find((m) => m.member_id === existingId) : null;
  const isAdminMember = selectedMember?.role === "Admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (useExisting && !existingId) {
      setError("Select a member");
      return;
    }
    if (!useExisting && !email.trim()) {
      setError("Email required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        waiver_agreed_at: waiverAgreedAt.trim() || "",
        form_1099_received_at: isAdminMember ? "" : form1099At.trim(),
        form_i9_received_at: isAdminMember ? "" : formI9At.trim(),
      };
      if (useExisting) {
        body.existing_member_id = existingId;
      } else {
        body.first_name = firstName.trim();
        body.last_name = lastName.trim();
        body.email = email.trim().toLowerCase();
        body.phone = phone.trim();
      }
      const res = await fetch("/api/admin/trainers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: { error?: string; detail?: string };
      try {
        data = await res.json();
      } catch {
        data = { error: `Request failed (${res.status})`, detail: await res.text().catch(() => "") };
      }
      if (res.ok) {
        router.push("/admin/block-time");
      } else {
        const msg = [data.error, data.detail].filter(Boolean).join(" — ");
        setError(msg || "Failed to create trainer");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Add trainer</h1>
      <p className="text-sm text-stone-600 mb-6">
        Add a gym staff member as a trainer. They’ll get access to their schedule to set availability. If the member is an admin, 1099 and I-9 are not required.
      </p>
      <Link href="/admin/block-time" className="text-brand-600 hover:underline text-sm mb-6 inline-block">← Block time</Link>

      <form onSubmit={handleSubmit} className="space-y-6 p-4 rounded-xl border border-stone-200 bg-white">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-2">Member</label>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2">
              <input type="radio" checked={useExisting} onChange={() => setUseExisting(true)} />
              Use existing member
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!useExisting} onChange={() => setUseExisting(false)} />
              Create new member
            </label>
          </div>
          {useExisting ? (
            <select
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            >
              <option value="">Select member…</option>
              {candidates.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {[m.first_name, m.last_name].filter(Boolean).join(" ")} {m.email ? `(${m.email})` : ""} {m.role === "Admin" ? "— Admin" : ""}
                </option>
              ))}
              {candidates.length === 0 && <option value="">No members available (all are already trainers)</option>}
            </select>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">First name</label>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Last name</label>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Email *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Phone (optional)</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
              </div>
            </div>
          )}
          {selectedMember?.role === "Admin" && (
            <p className="mt-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">This member is an admin; 1099 and I-9 are not required.</p>
          )}
        </div>

        <div>
          <h3 className="font-medium text-stone-800 mb-2">Documents</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Waiver agreed (date)</label>
              <input type="date" value={waiverAgreedAt} onChange={(e) => setWaiverAgreedAt(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
            </div>
            {!isAdminMember && (
              <>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">1099 received (date)</label>
                  <input type="date" value={form1099At} onChange={(e) => setForm1099At(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">I-9 received (date)</label>
                  <input type="date" value={formI9At} onChange={(e) => setFormI9At(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" />
                </div>
              </>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {submitting ? "Adding…" : "Add trainer"}
        </button>
      </form>
    </div>
  );
}
