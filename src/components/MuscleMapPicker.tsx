"use client";

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
};

const REGIONS: MuscleRegion[] = [
  {
    id: "chest",
    label: "Chest",
    side: "front",
    searchTerms: ["chest", "pectorals", "pectoralis", "upper chest"],
    nameTerms: ["bench", "chest press", "push up", "pushup", "pec", "fly"],
  },
  {
    id: "shoulders",
    label: "Shoulders",
    side: "front",
    searchTerms: ["shoulders", "delts", "deltoid", "anterior deltoid", "lateral deltoid"],
    nameTerms: ["shoulder", "overhead press", "arnold", "lateral raise", "front raise", "upright row"],
  },
  {
    id: "biceps",
    label: "Biceps",
    side: "front",
    searchTerms: ["biceps", "biceps brachii", "brachialis"],
    nameTerms: ["curl", "bicep", "preacher"],
  },
  {
    id: "forearms",
    label: "Forearms",
    side: "front",
    searchTerms: ["forearms", "brachioradialis", "wrist flexors", "wrist extensors"],
    nameTerms: ["wrist", "forearm", "grip"],
  },
  {
    id: "core",
    label: "Abs / Core",
    side: "front",
    searchTerms: ["abs", "abdominals", "rectus abdominis", "obliques", "core", "transverse abdominis"],
    nameTerms: ["crunch", "plank", "sit up", "sit-up", "ab wheel", "leg raise", "hollow", "bicycle"],
  },
  {
    id: "quads",
    label: "Quads",
    side: "front",
    searchTerms: ["quadriceps", "quads", "vastus lateralis", "vastus medialis", "vastus intermedius"],
    nameTerms: ["squat", "leg press", "leg extension", "lunge", "split squat", "step up", "hack squat"],
  },
  {
    id: "calves-front",
    label: "Calves",
    side: "front",
    searchTerms: ["calves", "soleus", "gastrocnemius"],
    nameTerms: ["calf"],
  },
  {
    id: "traps",
    label: "Traps",
    side: "back",
    searchTerms: ["traps", "trapezius", "levator scapulae"],
    nameTerms: ["shrug", "upright row", "face pull"],
  },
  {
    id: "upper-back",
    label: "Upper Back",
    side: "back",
    searchTerms: ["middle back", "upper back", "rhomboids", "teres major", "teres minor", "rear deltoid"],
    nameTerms: ["row", "face pull", "reverse fly", "rear delt"],
  },
  {
    id: "lats",
    label: "Lats",
    side: "back",
    searchTerms: ["lats", "latissimus dorsi"],
    nameTerms: ["lat", "pull up", "pullup", "chin up", "pulldown", "pull down"],
  },
  {
    id: "triceps",
    label: "Triceps",
    side: "back",
    searchTerms: ["triceps", "triceps brachii"],
    nameTerms: ["tricep", "pushdown", "skull crusher", "extension", "dip"],
  },
  {
    id: "lower-back",
    label: "Lower Back",
    side: "back",
    searchTerms: ["lower back", "erector spinae", "spinal erectors"],
    nameTerms: ["deadlift", "hyperextension", "good morning", "back extension"],
  },
  {
    id: "glutes",
    label: "Glutes",
    side: "back",
    searchTerms: ["glutes", "gluteus maximus", "gluteus medius", "gluteus minimus", "abductors"],
    nameTerms: ["glute", "hip thrust", "bridge", "kickback", "bulgarian", "split squat"],
  },
  {
    id: "hamstrings",
    label: "Hamstrings",
    side: "back",
    searchTerms: ["hamstrings", "biceps femoris", "semitendinosus", "semimembranosus"],
    nameTerms: ["leg curl", "romanian deadlift", "rdl", "good morning", "deadlift", "hamstring"],
  },
  {
    id: "calves-back",
    label: "Calves",
    side: "back",
    searchTerms: ["calves", "soleus", "gastrocnemius"],
    nameTerms: ["calf"],
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

function regionShape(region: MuscleRegion, selected: boolean, onSelect: () => void) {
  const baseClass = selected
    ? "fill-brand-500 stroke-brand-700"
    : "fill-brand-200 stroke-brand-500 hover:fill-brand-300";
  const common = {
    role: "button",
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent<SVGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    className: `${baseClass} cursor-pointer transition-colors focus:outline-none`,
    "aria-label": region.label,
  };

  switch (region.id) {
    case "chest":
      return <path {...common} d="M71 77 C58 70 47 76 45 91 C55 99 67 99 77 91 Z M89 91 C99 99 111 99 121 91 C119 76 108 70 95 77 Z" />;
    case "shoulders":
      return <path {...common} d="M43 73 C27 75 22 88 19 103 L38 108 C40 93 44 83 54 78 Z M112 78 C122 83 126 93 128 108 L147 103 C144 88 139 75 123 73 Z" />;
    case "biceps":
      return <path {...common} d="M27 108 C24 126 25 142 31 155 L45 149 C41 136 40 122 43 110 Z M123 110 C126 122 125 136 121 149 L135 155 C141 142 142 126 139 108 Z" />;
    case "forearms":
      return <path {...common} d="M31 157 C32 176 36 190 43 200 L55 194 C49 183 46 169 45 151 Z M121 151 C120 169 117 183 111 194 L123 200 C130 190 134 176 135 157 Z" />;
    case "core":
      return <path {...common} d="M62 99 L104 99 L111 158 C100 164 66 164 55 158 Z" />;
    case "quads":
      return <path {...common} d="M56 164 C53 190 53 219 61 244 L77 242 C75 214 76 189 82 166 Z M84 166 C90 189 91 214 89 242 L105 244 C113 219 113 190 110 164 Z" />;
    case "calves-front":
      return <path {...common} d="M62 248 C59 270 60 292 66 310 L80 308 C78 285 78 266 80 247 Z M86 247 C88 266 88 285 86 308 L100 310 C106 292 107 270 104 248 Z" />;
    case "traps":
      return <path {...common} d="M62 50 C70 62 96 62 104 50 L115 76 C95 84 71 84 51 76 Z" />;
    case "upper-back":
      return <path {...common} d="M48 80 C61 72 105 72 118 80 L109 122 C95 116 71 116 57 122 Z" />;
    case "lats":
      return <path {...common} d="M43 93 C33 104 31 127 37 147 L57 134 L57 104 Z M123 93 L109 104 L109 134 L129 147 C135 127 133 104 123 93 Z" />;
    case "triceps":
      return <path {...common} d="M28 105 C25 125 26 142 33 156 L48 149 C43 135 42 120 45 106 Z M121 106 C124 120 123 135 118 149 L133 156 C140 142 141 125 138 105 Z" />;
    case "lower-back":
      return <path {...common} d="M60 124 C72 119 94 119 106 124 L110 157 C99 164 67 164 56 157 Z" />;
    case "glutes":
      return <path {...common} d="M55 162 C66 154 78 158 82 173 C78 190 61 192 52 181 Z M84 173 C88 158 100 154 111 162 L114 181 C105 192 88 190 84 173 Z" />;
    case "hamstrings":
      return <path {...common} d="M56 187 C55 211 57 232 64 248 L79 246 C77 223 77 201 82 180 Z M84 180 C89 201 89 223 87 246 L102 248 C109 232 111 211 110 187 Z" />;
    case "calves-back":
      return <path {...common} d="M64 252 C60 274 61 294 67 311 L80 308 C78 288 78 269 81 250 Z M85 250 C88 269 88 288 86 308 L99 311 C105 294 106 274 102 252 Z" />;
    default:
      return null;
  }
}

function BodyMapSvg({
  side,
  selectedRegionId,
  onSelect,
}: {
  side: "front" | "back";
  selectedRegionId: string;
  onSelect: (id: string) => void;
}) {
  const regions = REGIONS.filter((region) => region.side === side);
  return (
    <svg viewBox="0 0 166 330" className="mx-auto h-80 w-full max-w-[13rem]" aria-label={`${side} muscle map`}>
      <circle cx="83" cy="31" r="20" className="fill-stone-100 stroke-stone-300" />
      <path d="M60 54 C69 68 97 68 106 54 L121 72 L112 165 L105 248 L99 315 L86 315 L83 249 L80 315 L67 315 L61 248 L54 165 L45 72 Z" className="fill-stone-50 stroke-stone-300" />
      <path d="M45 76 L26 104 L31 157 L44 200" className="fill-none stroke-stone-300" />
      <path d="M121 76 L140 104 L135 157 L122 200" className="fill-none stroke-stone-300" />
      {regions.map((region) => (
        <g key={region.id}>{regionShape(region, region.id === selectedRegionId, () => onSelect(region.id))}</g>
      ))}
    </svg>
  );
}

export function MuscleMapPicker({
  onPickExercise,
}: {
  onPickExercise: (exercise: MuscleMapExercise) => void;
}) {
  const [side, setSide] = useState<"front" | "back">("front");
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
    const region = REGIONS.find((item) => item.id === regionId);
    if (region) setSide(region.side);
    setSelectedRegionId(regionId);
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-800">Pick by muscle group</p>
          <p className="text-xs text-stone-500">Tap a muscle, then choose an exercise to fill your workout.</p>
        </div>
        <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5">
          {(["front", "back"] as const).map((nextSide) => (
            <button
              key={nextSide}
              type="button"
              onClick={() => {
                setSide(nextSide);
                const regionOnSide = REGIONS.find((region) => region.side === nextSide);
                if (regionOnSide && !REGIONS.some((region) => region.id === selectedRegionId && region.side === nextSide)) {
                  setSelectedRegionId(regionOnSide.id);
                }
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                side === nextSide ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {nextSide}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <BodyMapSvg side={side} selectedRegionId={selectedRegionId} onSelect={selectRegion} />
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
