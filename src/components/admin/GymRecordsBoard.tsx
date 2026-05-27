"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GYM_RECORD_AGE_BRACKETS,
  GYM_RECORD_EVENTS,
  type GymRecordAgeBracket,
  type GymRecordGender,
  type GymRecordEventKey,
  type GymRecordsGrid,
  emptyGymRecordsGrid,
} from "@/lib/gym-records";

function formatRecordLine(name: string, value: string): string {
  const n = name.trim();
  const v = value.trim();
  if (!n && !v) return "—";
  if (!n) return v;
  if (!v) return n;
  return `${n} - ${v}`;
}

function AgeBandSection({
  age,
  index,
  records,
  editing,
  draft,
  onDraftChange,
}: {
  age: GymRecordAgeBracket;
  index: number;
  records: GymRecordsGrid;
  editing: boolean;
  draft: GymRecordsGrid;
  onDraftChange: (age: GymRecordAgeBracket, gender: GymRecordGender, eventKey: GymRecordEventKey, field: "holder_name" | "record_value", value: string) => void;
}) {
  const dark = index % 2 === 1;
  const bg = dark ? "bg-black text-[#9ef6b2]" : "bg-[#9ef6b2] text-stone-950";
  const labelMuted = dark ? "text-stone-300" : "text-stone-700";
  const grid = editing ? draft : records;

  return (
    <div className={`${bg} px-4 py-6 sm:px-8`}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(7rem,0.55fr)_1fr_1fr] gap-6">
        <div className="flex items-start">
          <span className="text-3xl font-black tracking-tight sm:text-4xl">{age}</span>
        </div>

        {(["men", "women"] as GymRecordGender[]).map((gender) => (
          <div key={gender}>
            <h3 className="mb-4 text-center text-sm font-black uppercase tracking-wide sm:text-base">
              {gender === "men" ? "Men" : "Women"} {age}
            </h3>
            <div className="space-y-3">
              {GYM_RECORD_EVENTS.map((ev) => {
                const cell = grid[age][gender][ev.key];
                return (
                  <div key={ev.key} className="grid grid-cols-[minmax(5.5rem,6.5rem)_1fr] gap-2 items-start text-xs sm:text-sm">
                    <span className={`font-black uppercase leading-tight pt-0.5 ${labelMuted}`}>{ev.label}</span>
                    {editing ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={cell.holder_name}
                          onChange={(e) => onDraftChange(age, gender, ev.key, "holder_name", e.target.value)}
                          placeholder="Name"
                          className={`rounded border px-2 py-1 text-xs sm:text-sm ${dark ? "border-stone-600 bg-stone-900 text-white placeholder:text-stone-500" : "border-stone-400 bg-white text-stone-900"}`}
                        />
                        <input
                          type="text"
                          value={cell.record_value}
                          onChange={(e) => onDraftChange(age, gender, ev.key, "record_value", e.target.value)}
                          placeholder="Record (e.g. 265LBS, 5:12)"
                          className={`rounded border px-2 py-1 text-xs sm:text-sm ${dark ? "border-stone-600 bg-stone-900 text-white placeholder:text-stone-500" : "border-stone-400 bg-white text-stone-900"}`}
                        />
                      </div>
                    ) : (
                      <p className="font-bold uppercase leading-snug">{formatRecordLine(cell.holder_name, cell.record_value)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GymRecordsBoard() {
  const router = useRouter();
  const [records, setRecords] = useState<GymRecordsGrid>(emptyGymRecordsGrid());
  const [draft, setDraft] = useState<GymRecordsGrid>(emptyGymRecordsGrid());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/gym-records")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (!json) return;
        if (json.error) {
          setError(json.error);
          return;
        }
        const grid = json.records as GymRecordsGrid;
        setRecords(grid);
        setDraft(JSON.parse(JSON.stringify(grid)) as GymRecordsGrid);
      })
      .catch(() => setError("Could not load gym records."))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  function onDraftChange(
    age: GymRecordAgeBracket,
    gender: GymRecordGender,
    eventKey: GymRecordEventKey,
    field: "holder_name" | "record_value",
    value: string
  ) {
    setDraft((prev) => ({
      ...prev,
      [age]: {
        ...prev[age],
        [gender]: {
          ...prev[age][gender],
          [eventKey]: {
            ...prev[age][gender][eventKey],
            [field]: value,
          },
        },
      },
    }));
  }

  async function saveRecords() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gym-records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      const grid = json.records as GymRecordsGrid;
      setRecords(grid);
      setDraft(JSON.parse(JSON.stringify(grid)) as GymRecordsGrid);
      setEditing(false);
      setMessage("Gym records saved.");
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setDraft(JSON.parse(JSON.stringify(records)) as GymRecordsGrid);
    setEditing(false);
    setError(null);
  }

  if (loading) return <p className="text-stone-500">Loading gym records…</p>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-[#9ef6b2] hover:bg-stone-900"
          >
            Edit records
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveRecords()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save records"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancelEdit}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
        <p className="text-sm text-stone-600">Admin-edited only — does not auto-update from workouts.</p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

      <div className="overflow-hidden rounded-2xl bg-stone-700 shadow-2xl">
        <div className="bg-stone-700 px-6 py-8 text-center text-white">
          <div className="mb-4 flex justify-center">
            <Image src="/Lei_Logos.png" alt="Pono Fit Co." width={180} height={48} className="h-10 w-auto" />
          </div>
          <h2 className="text-4xl font-black uppercase tracking-tight sm:text-5xl md:text-6xl">Gym Records</h2>
        </div>

        {GYM_RECORD_AGE_BRACKETS.map((age, index) => (
          <AgeBandSection
            key={age}
            age={age}
            index={index}
            records={records}
            editing={editing}
            draft={draft}
            onDraftChange={onDraftChange}
          />
        ))}

        <div className="bg-stone-700 px-6 py-10 flex justify-center">
          <Image src="/Lei_Logos.png" alt="" width={220} height={56} className="h-14 w-auto opacity-95" />
        </div>
      </div>
    </>
  );
}
