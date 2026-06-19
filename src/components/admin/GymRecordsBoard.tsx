"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GymRecordsAgeBand } from "@/components/gym-records/GymRecordsAgeBand";
import {
  GYM_RECORD_AGE_BRACKETS,
  type GymRecordAgeBracket,
  type GymRecordGender,
  type GymRecordEventKey,
  type GymRecordsGrid,
  emptyGymRecordsGrid,
} from "@/lib/gym-records";

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
    placeIndex: number,
    field: "holder_name" | "record_value",
    value: string
  ) {
    setDraft((prev) => {
      const places = [...prev[age][gender][eventKey]];
      places[placeIndex] = { ...places[placeIndex]!, [field]: value };
      return {
        ...prev,
        [age]: {
          ...prev[age],
          [gender]: {
            ...prev[age][gender],
            [eventKey]: places,
          },
        },
      };
    });
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
        <Link
          href="/admin/the-board/tv"
          target="_blank"
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50"
        >
          Open TV display ↗
        </Link>
        <p className="text-sm text-stone-600">
          1st / 2nd / 3rd per lift · each card shows Men (top) + Women (bottom) · TV ends on Weekly Goals top 10
        </p>
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
          <GymRecordsAgeBand
            key={age}
            age={age}
            index={index}
            records={records}
            editing={editing}
            draft={draft}
            onDraftChange={onDraftChange}
          />
        ))}

        <div className="flex justify-center bg-stone-700 px-6 py-10">
          <Image src="/Lei_Logos.png" alt="" width={220} height={56} className="h-14 w-auto opacity-95" />
        </div>
      </div>
    </>
  );
}
