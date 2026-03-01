"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type BookingItem = { type: string; sortKey: string; label: string; trainer?: string };
type WorkoutItem = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trainer_notes?: string | null;
  client_completion_notes?: string | null;
  exercises: { exercise_name: string; type: string; sets: { reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null }[] }[];
};
type BodyCompEntry = {
  id: number;
  recorded_at: string;
  weight: number | null;
  bmi: number | null;
  fat_pct: number | null;
  bmr: number | null;
  impedance: number | null;
  fat_mass: number | null;
  ffm: number | null;
  tbw: number | null;
  hydration_pct: number | null;
  body_type: string | null;
  gender: string | null;
  age: number | null;
  height: string | null;
  notes: string | null;
};
type ClientGoals = {
  goal_weight: number | null;
  goal_body_fat: number | null;
  goal_muscle_gain: number | null;
  updated_at: string | null;
} | null;

export default function ClientPTDashboardPage() {
  const params = useParams();
  const clientId = (params.clientId as string) ?? "";
  const [clientName, setClientName] = useState<string>("");
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [bodyComp, setBodyComp] = useState<BodyCompEntry[]>([]);
  const [clientGoals, setClientGoals] = useState<ClientGoals>(null);
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsForm, setGoalsForm] = useState({ goal_weight: "", goal_body_fat: "", goal_muscle_gain: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBodyCompForm, setShowBodyCompForm] = useState(false);
  const [bodyCompSaving, setBodyCompSaving] = useState(false);
  const [bodyCompForm, setBodyCompForm] = useState({
    recorded_at: new Date().toISOString().slice(0, 10),
    weight: "",
    bmi: "",
    fat_pct: "",
    bmr: "",
    impedance: "",
    tbw: "",
    hydration_pct: "",
    body_type: "standard",
    gender: "",
    age: "",
    height: "",
    notes: "",
  });

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/bookings`).then((r) => (r.ok ? r.json() : { bookings: [] })),
      fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/workouts`).then((r) => (r.ok ? r.json() : { workouts: [] })),
      fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/body-composition`).then((r) => (r.ok ? r.json() : { entries: [] })),
      fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/goals`).then((r) => (r.ok ? r.json() : { goals: null })),
      fetch(`/api/members/${encodeURIComponent(clientId)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([bookingsRes, workoutsRes, bodyCompRes, goalsRes, memberRes]) => {
        setBookings(Array.isArray(bookingsRes.bookings) ? bookingsRes.bookings : []);
        setWorkouts(Array.isArray(workoutsRes.workouts) ? workoutsRes.workouts : []);
        setBodyComp(Array.isArray(bodyCompRes.entries) ? bodyCompRes.entries : []);
        setClientGoals(goalsRes.goals ?? null);
        const m = memberRes?.member as { first_name?: string; last_name?: string } | undefined;
        setClientName(m ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || clientId : clientId);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clientId]);

  function formatDate(s: string) {
    if (!s) return "";
    try {
      const d = new Date(s);
      return d.toLocaleDateString("en-US", { dateStyle: "short" }) + (s.includes("T") ? " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
    } catch {
      return s.slice(0, 16);
    }
  }

  function submitBodyComp(e: React.FormEvent) {
    e.preventDefault();
    setBodyCompSaving(true);
    const payload: Record<string, unknown> = {
      recorded_at: bodyCompForm.recorded_at,
      body_type: bodyCompForm.body_type || null,
      gender: bodyCompForm.gender || null,
      age: bodyCompForm.age ? parseInt(bodyCompForm.age, 10) : null,
      height: bodyCompForm.height || null,
      weight: bodyCompForm.weight ? parseFloat(bodyCompForm.weight) : null,
      bmi: bodyCompForm.bmi ? parseFloat(bodyCompForm.bmi) : null,
      fat_pct: bodyCompForm.fat_pct ? parseFloat(bodyCompForm.fat_pct) : null,
      bmr: bodyCompForm.bmr ? parseInt(bodyCompForm.bmr, 10) : null,
      impedance: bodyCompForm.impedance ? parseInt(bodyCompForm.impedance, 10) : null,
      ffm: null,
      tbw: bodyCompForm.tbw ? parseFloat(bodyCompForm.tbw) : null,
      hydration_pct: bodyCompForm.hydration_pct ? parseFloat(bodyCompForm.hydration_pct) : null,
      notes: bodyCompForm.notes || null,
    };
    fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/body-composition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.entry) {
          setBodyComp((prev) => [data.entry, ...prev]);
          setShowBodyCompForm(false);
          setBodyCompForm({ ...bodyCompForm, recorded_at: new Date().toISOString().slice(0, 10), weight: "", bmi: "", fat_pct: "", bmr: "", impedance: "", tbw: "", hydration_pct: "", notes: "" });
        }
      })
      .finally(() => setBodyCompSaving(false));
  }

  /** Simple line chart: points is [{x: dateLabel, y: number}], height 80. Needs at least 2 points. */
  function MiniChart({ points, label, unit }: { points: { x: string; y: number }[]; label: string; unit?: string }) {
    const valid = points.filter((p) => typeof p.y === "number" && !Number.isNaN(p.y));
    if (valid.length < 2) return null;
    const minV = Math.min(...valid.map((p) => p.y));
    const maxV = Math.max(...valid.map((p) => p.y));
    const range = maxV - minV || 1;
    const padding = 24;
    const w = 280;
    const h = 80;
    const pts = valid
      .map((p, i) => {
        const x = padding + (i / Math.max(1, valid.length - 1)) * (w - padding * 2);
        const y = h - padding - ((p.y - minV) / range) * (h - padding * 2);
        return `${x},${y}`;
      })
      .join(" ");
    return (
      <div className="inline-block">
        <p className="text-xs font-medium text-stone-500 mb-1">{label}{unit ? ` (${unit})` : ""}</p>
        <svg width={w} height={h} className="overflow-visible">
          <polyline points={pts} fill="none" stroke="var(--brand-600, #0d9488)" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  if (!clientId) return <div className="p-6 text-stone-500">No client selected.</div>;
  if (loading) return <div className="p-6 text-stone-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/trainer/my-clients" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">← My Clients</Link>
        <h1 className="text-2xl font-bold text-stone-800">Client PT Dashboard</h1>
        <p className="text-stone-600 mt-1">
          <Link href={`/members/${clientId}`} className="text-brand-600 hover:underline font-medium">{clientName}</Link>
        </p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="text-lg font-semibold text-stone-800">Create Workout for Member</h2>
          <Link
            href={`/trainer/my-clients/${clientId}/create-workout`}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
          >
            Create Workout for Member
          </Link>
        </div>
        <p className="text-sm text-stone-500">Send a workout to this client. They will see it under &quot;Workouts from my trainer&quot; and can fill in sets, reps, and weight, then finish to send results back here.</p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold text-stone-800">Body Composition</h2>
          <button
            type="button"
            onClick={() => setShowBodyCompForm(true)}
            className="px-4 py-2 rounded-lg bg-stone-700 text-white text-sm font-medium hover:bg-stone-800"
          >
            Add reading
          </button>
        </div>
        <p className="text-sm text-stone-500 mb-3">Track weight, body fat %, BMI, and other metrics over time. Matches your Body-Comp-Sample.csv fields.</p>

        {/* Goals at top: fillable until set, then display with Edit/Clear */}
        <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-white">
          <h3 className="text-base font-semibold text-stone-800 mb-3">Goals</h3>
          {(!clientGoals || (clientGoals.goal_weight == null && clientGoals.goal_body_fat == null && clientGoals.goal_muscle_gain == null)) && !goalsEditing ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-500">Set goal weight, body fat %, and/or muscle gain. Used in conversion formulas below.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setGoalsSaving(true);
                  const payload = {
                    goal_weight: goalsForm.goal_weight ? parseFloat(goalsForm.goal_weight) : null,
                    goal_body_fat: goalsForm.goal_body_fat ? parseFloat(goalsForm.goal_body_fat) : null,
                    goal_muscle_gain: goalsForm.goal_muscle_gain ? parseFloat(goalsForm.goal_muscle_gain) : null,
                  };
                  fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/goals`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  })
                    .then((r) => r.json())
                    .then((data) => {
                      setClientGoals(data.goals);
                      setGoalsForm({ goal_weight: "", goal_body_fat: "", goal_muscle_gain: "" });
                    })
                    .finally(() => setGoalsSaving(false));
                }}
                className="flex flex-wrap gap-4 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal weight (lbs)</label>
                  <input type="number" step="0.01" value={goalsForm.goal_weight} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_weight: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="e.g. 150" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal body fat %</label>
                  <input type="number" step="0.01" value={goalsForm.goal_body_fat} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_body_fat: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="e.g. 25" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal muscle gain (lbs)</label>
                  <input type="number" step="0.01" value={goalsForm.goal_muscle_gain} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_muscle_gain: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="e.g. 5" />
                </div>
                <button type="submit" disabled={goalsSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                  {goalsSaving ? "Saving…" : "Set goals"}
                </button>
              </form>
            </div>
          ) : goalsEditing ? (
            <div className="space-y-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setGoalsSaving(true);
                  const payload = {
                    goal_weight: goalsForm.goal_weight ? parseFloat(goalsForm.goal_weight) : null,
                    goal_body_fat: goalsForm.goal_body_fat ? parseFloat(goalsForm.goal_body_fat) : null,
                    goal_muscle_gain: goalsForm.goal_muscle_gain ? parseFloat(goalsForm.goal_muscle_gain) : null,
                  };
                  fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/goals`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  })
                    .then((r) => r.json())
                    .then((data) => {
                      setClientGoals(data.goals);
                      setGoalsEditing(false);
                      setGoalsForm({ goal_weight: "", goal_body_fat: "", goal_muscle_gain: "" });
                    })
                    .finally(() => setGoalsSaving(false));
                }}
                className="flex flex-wrap gap-4 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal weight (lbs)</label>
                  <input type="number" step="0.01" value={goalsForm.goal_weight} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_weight: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder={clientGoals?.goal_weight != null ? String(clientGoals.goal_weight) : "e.g. 150"} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal body fat %</label>
                  <input type="number" step="0.01" value={goalsForm.goal_body_fat} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_body_fat: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder={clientGoals?.goal_body_fat != null ? String(clientGoals.goal_body_fat) : "e.g. 25"} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-0.5">Goal muscle gain (lbs)</label>
                  <input type="number" step="0.01" value={goalsForm.goal_muscle_gain} onChange={(e) => setGoalsForm((f) => ({ ...f, goal_muscle_gain: e.target.value }))} className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder={clientGoals?.goal_muscle_gain != null ? String(clientGoals.goal_muscle_gain) : "e.g. 5"} />
                </div>
                <button type="submit" disabled={goalsSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                  {goalsSaving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => { setGoalsEditing(false); setGoalsForm({ goal_weight: "", goal_body_fat: "", goal_muscle_gain: "" }); }} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50">
                  Cancel
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              {clientGoals?.goal_weight != null && <span className="text-sm text-stone-700"><span className="font-medium text-stone-600">Goal weight:</span> {clientGoals.goal_weight} lbs</span>}
              {clientGoals?.goal_body_fat != null && <span className="text-sm text-stone-700"><span className="font-medium text-stone-600">Goal body fat:</span> {clientGoals.goal_body_fat}%</span>}
              {clientGoals?.goal_muscle_gain != null && <span className="text-sm text-stone-700"><span className="font-medium text-stone-600">Goal muscle gain:</span> {clientGoals.goal_muscle_gain} lbs</span>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setGoalsEditing(true); setGoalsForm({ goal_weight: clientGoals?.goal_weight != null ? String(clientGoals.goal_weight) : "", goal_body_fat: clientGoals?.goal_body_fat != null ? String(clientGoals.goal_body_fat) : "", goal_muscle_gain: clientGoals?.goal_muscle_gain != null ? String(clientGoals.goal_muscle_gain) : "" }); }} className="text-sm text-brand-600 hover:underline font-medium">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGoalsSaving(true);
                    fetch(`/api/trainer/clients/${encodeURIComponent(clientId)}/goals`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ goal_weight: null, goal_body_fat: null, goal_muscle_gain: null }),
                    })
                      .then((r) => r.json())
                      .then((data) => {
                        setClientGoals(data.goals);
                        setGoalsForm({ goal_weight: "", goal_body_fat: "", goal_muscle_gain: "" });
                      })
                      .finally(() => setGoalsSaving(false));
                  }}
                  disabled={goalsSaving}
                  className="text-sm text-stone-500 hover:text-stone-700"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {bodyComp.length > 0 && (
          <div className="flex flex-wrap gap-6 mb-4 p-4 rounded-xl border border-stone-200 bg-stone-50">
            <MiniChart
              points={[...bodyComp].reverse().map((e) => ({ x: e.recorded_at, y: e.weight ?? 0 })).filter((p) => p.y > 0)}
              label="Weight"
              unit="lbs"
            />
            <MiniChart
              points={[...bodyComp].reverse().map((e) => ({ x: e.recorded_at, y: e.fat_pct ?? 0 })).filter((p) => p.y > 0)}
              label="Body fat %"
              unit="%"
            />
            <MiniChart
              points={[...bodyComp].reverse().map((e) => ({ x: e.recorded_at, y: e.bmi ?? 0 })).filter((p) => p.y > 0)}
              label="BMI"
            />
          </div>
        )}

        {bodyComp.length > 0 && (() => {
          const latest = bodyComp[0];
          const W = latest.weight ?? 0;
          const FM = latest.fat_mass ?? 0;
          const FFM = latest.ffm ?? 0;
          const FP = clientGoals?.goal_body_fat != null ? (clientGoals.goal_body_fat / 100) : 0.25;
          const conversion = FM * (1 - FP) - FP * FFM;
          const target100 = (1 - FP) !== 0 ? (FM - FP * W) / (1 - FP) : null;
          const denom90 = 0.9 - FP;
          const target9010 = denom90 !== 0 ? (FM * (1 - FP) - FP * FFM) / denom90 : null;
          const hasValues = W > 0 && (FM > 0 || FFM > 0);
          if (!hasValues) return null;
          return (
            <div className="mb-4 p-4 rounded-xl border border-stone-200 bg-amber-50/50">
              <h3 className="text-sm font-semibold text-stone-800 mb-2">Conversion formulas (latest reading)</h3>
              <p className="text-xs text-stone-500 mb-2">FP = goal body fat as decimal (e.g. 25% → 0.25). Using {clientGoals?.goal_body_fat != null ? `${clientGoals.goal_body_fat}%` : "default 25%"}.</p>
              <ul className="space-y-1 text-sm">
                <li><span className="font-medium text-stone-700">Conversion:</span>{" "}<span className="font-mono text-stone-800">{Number(conversion).toFixed(2)} lbs</span>{" "}<span className="text-stone-500">— how much pure fat to muscle conversion is necessary to hit target</span></li>
                {target100 != null && <li><span className="font-medium text-stone-700">100% Fat:</span>{" "}<span className="font-mono text-stone-800">{Number(target100).toFixed(2)} lbs</span>{" "}<span className="text-stone-500">— how much pure fat loss is necessary to hit target</span></li>}
                {target9010 != null && <li><span className="font-medium text-stone-700">90/10 Fat Loss:</span>{" "}<span className="font-mono text-stone-800">{Number(target9010).toFixed(2)} lbs</span></li>}
              </ul>
            </div>
          );
        })()}

        {bodyComp.length === 0 ? (
          <p className="text-stone-500 text-sm">No body composition readings yet. Click &quot;Add reading&quot; to add one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-stone-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-stone-100 text-left">
                  <th className="p-2 font-medium text-stone-700">Date</th>
                  <th className="p-2 font-medium text-stone-700">Weight</th>
                  <th className="p-2 font-medium text-stone-700">Fat %</th>
                  <th className="p-2 font-medium text-stone-700">Fat mass</th>
                  <th className="p-2 font-medium text-stone-700">BMI</th>
                  <th className="p-2 font-medium text-stone-700">FFM</th>
                  <th className="p-2 font-medium text-stone-700">TBW</th>
                </tr>
              </thead>
              <tbody>
                {bodyComp.map((e) => (
                  <tr key={e.id} className="border-t border-stone-200 bg-white">
                    <td className="p-2 text-stone-800">{e.recorded_at}</td>
                    <td className="p-2">{e.weight != null ? `${e.weight} lbs` : "—"}</td>
                    <td className="p-2">{e.fat_pct != null ? `${e.fat_pct}%` : "—"}</td>
                    <td className="p-2">{e.fat_mass != null ? `${e.fat_mass} lbs` : "—"}</td>
                    <td className="p-2">{e.bmi != null ? e.bmi : "—"}</td>
                    <td className="p-2">{e.ffm != null ? e.ffm : "—"}</td>
                    <td className="p-2">{e.tbw != null ? e.tbw : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showBodyCompForm && (
          <>
            <div className="fixed inset-0 bg-stone-900/50 z-40" aria-hidden onClick={() => setShowBodyCompForm(false)} />
            <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-stone-800 mb-4">Add body composition reading</h3>
              <p className="text-sm text-stone-500 mb-3">Only <strong>weight</strong> and <strong>body fat %</strong> are required for conversion formulas; fat mass and FFM are calculated automatically.</p>
              <form onSubmit={submitBodyComp} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Date</label>
                    <input type="date" value={bodyCompForm.recorded_at} onChange={(e) => setBodyCompForm((f) => ({ ...f, recorded_at: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Weight (lbs)</label>
                    <input type="number" step="0.01" value={bodyCompForm.weight} onChange={(e) => setBodyCompForm((f) => ({ ...f, weight: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="197.21" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Body fat %</label>
                    <input type="number" step="0.01" value={bodyCompForm.fat_pct} onChange={(e) => setBodyCompForm((f) => ({ ...f, fat_pct: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="48.6" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">BMI</label>
                    <input type="number" step="0.1" value={bodyCompForm.bmi} onChange={(e) => setBodyCompForm((f) => ({ ...f, bmi: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="32.8" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">BMR</label>
                    <input type="number" value={bodyCompForm.bmr} onChange={(e) => setBodyCompForm((f) => ({ ...f, bmr: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="1660" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Impedance</label>
                    <input type="number" value={bodyCompForm.impedance} onChange={(e) => setBodyCompForm((f) => ({ ...f, impedance: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="672" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">TBW (total body water)</label>
                    <input type="number" step="0.01" value={bodyCompForm.tbw} onChange={(e) => setBodyCompForm((f) => ({ ...f, tbw: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="74.21" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Hydration %</label>
                    <input type="number" step="0.01" value={bodyCompForm.hydration_pct} onChange={(e) => setBodyCompForm((f) => ({ ...f, hydration_pct: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="Auto from TBW/weight" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Body type</label>
                    <select value={bodyCompForm.body_type} onChange={(e) => setBodyCompForm((f) => ({ ...f, body_type: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm">
                      <option value="standard">Standard</option>
                      <option value="athletic">Athletic</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Gender</label>
                    <input type="text" value={bodyCompForm.gender} onChange={(e) => setBodyCompForm((f) => ({ ...f, gender: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="female" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Age</label>
                    <input type="number" value={bodyCompForm.age} onChange={(e) => setBodyCompForm((f) => ({ ...f, age: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="34" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Height</label>
                    <input type="text" value={bodyCompForm.height} onChange={(e) => setBodyCompForm((f) => ({ ...f, height: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" placeholder="5'5&quot;" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-stone-600 mb-0.5">Notes</label>
                    <input type="text" value={bodyCompForm.notes} onChange={(e) => setBodyCompForm((f) => ({ ...f, notes: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={bodyCompSaving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                    {bodyCompSaving ? "Saving…" : "Save reading"}
                  </button>
                  <button type="button" onClick={() => setShowBodyCompForm(false)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">PT Bookings (chronological)</h2>
        {bookings.length === 0 ? (
          <p className="text-stone-500 text-sm">No PT bookings yet.</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b, i) => (
              <li key={i} className="flex items-center gap-2 p-3 rounded-lg border border-stone-200 bg-white text-sm">
                <span className="text-stone-700">{b.label}</span>
                {b.trainer && <span className="text-stone-400">· {b.trainer}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-stone-800 mb-3">Workouts Sent to Client</h2>
        {workouts.length === 0 ? (
          <p className="text-stone-500 text-sm">No workouts sent yet. Create one above.</p>
        ) : (
          <ul className="space-y-4">
            {workouts.map((w) => (
              <li key={w.id} className="p-4 rounded-xl border border-stone-200 bg-white">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-medium text-stone-800">{formatDate(w.started_at)}</span>
                  {w.finished_at ? (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Completed — results below</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Not started</span>
                  )}
                </div>
                <ul className="space-y-2 text-sm">
                  {w.exercises.map((ex, ei) => (
                    <li key={ei}>
                      <span className="font-medium text-stone-700">{ex.exercise_name}</span>
                      <span className="ml-2 text-stone-500 capitalize">({ex.type})</span>
                      {ex.sets.length > 0 && (
                        <ul className="mt-1 ml-4 text-stone-600">
                          {ex.sets.map((s, si) => (
                            <li key={si}>
                              Set {si + 1}:{" "}
                              {ex.type === "lift"
                                ? `${s.reps ?? "—"} reps × ${s.weight_kg != null ? `${s.weight_kg} kg` : "—"}`
                                : `${s.time_seconds != null ? `${Math.round(s.time_seconds / 60)} min` : "—"}${s.distance_km != null ? ` · ${s.distance_km} km` : ""}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                {(w.trainer_notes || w.client_completion_notes) && (
                  <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                    {w.trainer_notes && (
                      <div className="text-sm">
                        <span className="font-medium text-stone-600">Your note to client:</span>
                        <p className="text-stone-700 whitespace-pre-wrap mt-0.5">{w.trainer_notes}</p>
                      </div>
                    )}
                    {w.client_completion_notes && (
                      <div className="text-sm p-2 rounded-lg bg-brand-50 border border-brand-100">
                        <span className="font-medium text-brand-800">Client&apos;s notes:</span>
                        <p className="text-stone-700 whitespace-pre-wrap mt-0.5">{w.client_completion_notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
