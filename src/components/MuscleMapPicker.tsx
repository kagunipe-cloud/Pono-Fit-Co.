"use client";

import Image from "next/image";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

export type MuscleMapExercise = {
  id: number;
  name: string;
  type: string;
  primary_muscles?: string | null;
  secondary_muscles?: string | null;
  muscle_group?: string | null;
  equipment?: string | null;
};

type MuscleRegion = {
  id: string;
  label: string;
  side: "front" | "back";
  searchTerms: string[];
  nameTerms: string[];
  hitbox: {
    left: string;
    top: string;
    width: string;
    height: string;
  };
};

const REGIONS: MuscleRegion[] = [
  {
    id: "chest",
    label: "Chest",
    side: "front",
    searchTerms: ["chest", "pectorals", "pectoralis", "upper chest"],
    nameTerms: ["bench", "chest press", "push up", "pushup", "pec", "fly"],
    hitbox: { left: "39%", top: "19%", width: "9%", height: "12%" },
  },
  {
    id: "shoulders",
    label: "Shoulders",
    side: "front",
    searchTerms: ["shoulders", "delts", "deltoid", "anterior deltoid", "lateral deltoid"],
    nameTerms: ["shoulder", "overhead press", "arnold", "lateral raise", "front raise", "upright row"],
    hitbox: { left: "25%", top: "17%", width: "19%", height: "12%" },
  },
  {
    id: "biceps",
    label: "Biceps",
    side: "front",
    searchTerms: ["biceps", "biceps brachii", "brachialis"],
    nameTerms: ["curl", "bicep", "preacher"],
    hitbox: { left: "25%", top: "26%", width: "18%", height: "13%" },
  },
  {
    id: "forearms",
    label: "Forearms",
    side: "front",
    searchTerms: ["forearms", "brachioradialis", "wrist flexors", "wrist extensors"],
    nameTerms: ["wrist", "forearm", "grip"],
    hitbox: { left: "24%", top: "38%", width: "19%", height: "14%" },
  },
  {
    id: "core",
    label: "Abs / Core",
    side: "front",
    searchTerms: ["abs", "abdominals", "rectus abdominis", "obliques", "core", "transverse abdominis"],
    nameTerms: ["crunch", "plank", "sit up", "sit-up", "ab wheel", "leg raise", "hollow", "bicycle"],
    hitbox: { left: "39%", top: "31%", width: "10%", height: "21%" },
  },
  {
    id: "quads",
    label: "Quads",
    side: "front",
    searchTerms: ["quadriceps", "quads", "vastus lateralis", "vastus medialis", "vastus intermedius"],
    nameTerms: ["squat", "leg press", "leg extension", "lunge", "split squat", "step up", "hack squat"],
    hitbox: { left: "31%", top: "51%", width: "18%", height: "22%" },
  },
  {
    id: "calves-front",
    label: "Calves",
    side: "front",
    searchTerms: ["calves", "soleus", "gastrocnemius"],
    nameTerms: ["calf"],
    hitbox: { left: "33%", top: "75%", width: "15%", height: "17%" },
  },
  {
    id: "traps",
    label: "Traps",
    side: "back",
    searchTerms: ["traps", "trapezius", "levator scapulae"],
    nameTerms: ["shrug", "upright row", "face pull"],
    hitbox: { left: "70%", top: "8%", width: "13%", height: "9%" },
  },
  {
    id: "upper-back",
    label: "Upper Back",
    side: "back",
    searchTerms: ["middle back", "upper back", "rhomboids", "teres major", "teres minor", "rear deltoid"],
    nameTerms: ["row", "face pull", "reverse fly", "rear delt"],
    hitbox: { left: "69%", top: "17%", width: "17%", height: "13%" },
  },
  {
    id: "lats",
    label: "Lats",
    side: "back",
    searchTerms: ["lats", "latissimus dorsi"],
    nameTerms: ["lat", "pull up", "pullup", "chin up", "pulldown", "pull down"],
    hitbox: { left: "68%", top: "29%", width: "17%", height: "15%" },
  },
  {
    id: "triceps",
    label: "Triceps",
    side: "back",
    searchTerms: ["triceps", "triceps brachii"],
    nameTerms: ["tricep", "pushdown", "skull crusher", "extension", "dip"],
    hitbox: { left: "80%", top: "27%", width: "15%", height: "18%" },
  },
  {
    id: "lower-back",
    label: "Lower Back",
    side: "back",
    searchTerms: ["lower back", "erector spinae", "spinal erectors"],
    nameTerms: ["deadlift", "hyperextension", "good morning", "back extension"],
    hitbox: { left: "70%", top: "40%", width: "17%", height: "13%" },
  },
  {
    id: "glutes",
    label: "Glutes",
    side: "back",
    searchTerms: ["glutes", "gluteus maximus", "gluteus medius", "gluteus minimus", "abductors"],
    nameTerms: ["glute", "hip thrust", "bridge", "kickback", "bulgarian", "split squat"],
    hitbox: { left: "69%", top: "50%", width: "18%", height: "15%" },
  },
  {
    id: "hamstrings",
    label: "Hamstrings",
    side: "back",
    searchTerms: ["hamstrings", "biceps femoris", "semitendinosus", "semimembranosus"],
    nameTerms: ["leg curl", "romanian deadlift", "rdl", "good morning", "deadlift", "hamstring"],
    hitbox: { left: "70%", top: "63%", width: "17%", height: "14%" },
  },
  {
    id: "calves-back",
    label: "Calves",
    side: "back",
    searchTerms: ["calves", "soleus", "gastrocnemius"],
    nameTerms: ["calf"],
    hitbox: { left: "70%", top: "76%", width: "15%", height: "16%" },
  },
];

const DEFAULT_REGION_ID = "glutes";

function normalizedText(exercise: MuscleMapExercise): string {
  return [
    exercise.name,
    exercise.primary_muscles,
    exercise.secondary_muscles,
    exercise.muscle_group,
    exercise.equipment,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreExercise(exercise: MuscleMapExercise, region: MuscleRegion): number {
  const text = normalizedText(exercise);
  const name = exercise.name.toLowerCase();
  let score = 0;
  for (const term of region.searchTerms) {
    if (text.includes(term)) score += 4;
  }
  for (const term of region.nameTerms) {
    if (name.includes(term)) score += 3;
  }
  if (exercise.primary_muscles && region.searchTerms.some((term) => exercise.primary_muscles?.toLowerCase().includes(term))) {
    score += 6;
  }
  return score;
}

function BodyMapImage({
  selectedRegionId,
  onSelect,
}: {
  selectedRegionId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white">
      {/* Native image keeps the anatomy looking polished; transparent hit zones keep it interactive. */}
      <Image
        src="/body-image.png"
        alt="Front and back muscle groups"
        width={1536}
        height={1024}
        className="block w-full h-auto select-none"
        draggable={false}
      />
      {REGIONS.map((region) => {
        const selected = region.id === selectedRegionId;
        return (
          <button
            key={region.id}
            type="button"
            onClick={() => onSelect(region.id)}
            onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(region.id);
              }
            }}
            className={`absolute rounded-full transition-all ${
              selected
                ? "bg-brand-400/30 ring-2 ring-brand-600 ring-offset-2"
                : "bg-transparent hover:bg-brand-300/20 hover:ring-2 hover:ring-brand-500/60"
            }`}
            style={region.hitbox}
            aria-label={region.label}
            title={region.label}
          />
        );
      })}
    </div>
  );
}

export function MuscleMapPicker({
  onPickExercise,
}: {
  onPickExercise: (exercise: MuscleMapExercise) => void;
}) {
  const [selectedRegionId, setSelectedRegionId] = useState(DEFAULT_REGION_ID);
  const [exercises, setExercises] = useState<MuscleMapExercise[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedRegion = REGIONS.find((region) => region.id === selectedRegionId) ?? REGIONS[0]!;

  useEffect(() => {
    setLoading(true);
    fetch("/api/exercises?type=lift")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MuscleMapExercise[]) => {
        setExercises(Array.isArray(list) ? list.filter((exercise) => exercise.type === "lift") : []);
      })
      .catch(() => setExercises([]))
      .finally(() => setLoading(false));
  }, []);

  const suggestions = useMemo(() => {
    return exercises
      .map((exercise) => ({ exercise, score: scoreExercise(exercise, selectedRegion) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
      .slice(0, 18)
      .map((row) => row.exercise);
  }, [exercises, selectedRegion]);

  function selectRegion(regionId: string) {
    setSelectedRegionId(regionId);
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-800">Pick by muscle group</p>
          <p className="text-xs text-stone-500">Tap a muscle, then choose an exercise to fill your workout.</p>
        </div>
        <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
          Front + Back
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <BodyMapImage selectedRegionId={selectedRegionId} onSelect={selectRegion} />
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
              {selectedRegion.label}
            </span>
            {loading && <span className="text-xs text-stone-400">Loading exercises...</span>}
          </div>

          {suggestions.length > 0 ? (
            <ul className="max-h-72 overflow-auto rounded-lg border border-stone-200 divide-y divide-stone-100">
              {suggestions.map((exercise) => (
                <li key={exercise.id}>
                  <button
                    type="button"
                    onClick={() => onPickExercise(exercise)}
                    className="block w-full px-3 py-2 text-left hover:bg-brand-50"
                  >
                    <span className="block text-sm font-medium text-stone-800">{exercise.name}</span>
                    <span className="block text-xs text-stone-500">
                      {[exercise.primary_muscles, exercise.equipment].filter(Boolean).join(" - ") || "Lift"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500">
              No matches yet. Try another muscle group or use the search box below.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
