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
  color: string;
  polygons: string[];
};

type TracePoint = { x: number; y: number };
type TraceOffset = { dx: number; dy: number };

const REGIONS: MuscleRegion[] = [
  {
    id: "chest",
    label: "Chest",
    side: "front",
    searchTerms: ["chest", "pectorals", "pectoralis", "upper chest"],
    nameTerms: ["bench", "chest press", "push up", "pushup", "pec", "fly"],
    color: "#ef4444",
    polygons: [
      "42.8,18.5 48.2,18.7 50.0,20.0 52.8,18.3 57.5,18.2 60.3,19.3 62.9,20.8 63.4,23.0 62.8,25.2 62.4,26.6 61.1,28.1 58.3,29.0 56.1,28.9 53.7,28.3 51.9,27.6 50.0,25.9 48.7,27.5 46.9,28.3 44.5,28.8 42.6,29.1 41.1,28.7 39.5,28.1 38.3,26.9 37.8,24.7 37.0,22.6 37.7,20.8 39.9,19.4",
    ],
  },
  {
    id: "shoulders",
    label: "Shoulders",
    side: "front",
    searchTerms: ["shoulders", "delts", "deltoid", "anterior deltoid", "lateral deltoid"],
    nameTerms: ["shoulder", "overhead press", "arnold", "lateral raise", "front raise", "upright row"],
    color: "#f97316",
    polygons: [
      "40.7,17.7 38.1,17.2 35.4,18.1 33.3,19.1 31.7,21.1 31.2,23.4 31.8,26.1 34.0,24.7 36.0,23.4 36.9,22.2 38.3,20.5 40.0,19.4 42.8,18.4",
      "57.9,18.3 60.3,19.3 62.3,20.4 63.6,22.0 63.6,23.2 65.9,24.4 67.9,25.8 69.2,26.5 69.6,24.6 69.5,22.0 68.4,19.9 66.5,18.3 64.2,17.6 62.3,17.3 60.1,17.7",
    ],
  },
  {
    id: "biceps",
    label: "Biceps",
    side: "front",
    searchTerms: ["biceps", "biceps brachii", "brachialis"],
    nameTerms: ["curl", "bicep", "preacher"],
    color: "#65a30d",
    polygons: [
      "36.7,23.2 34.7,24.5 32.5,25.9 31.2,27.0 30.6,28.5 30.3,30.5 29.9,32.3 31.0,34.4 32.2,35.5 34.2,34.5 36.0,33.1 36.9,31.2 37.9,29.0 38.0,27.2 37.6,25.1",
      "63.9,23.0 62.8,25.6 62.6,28.8 63.6,31.0 64.3,32.6 66.4,34.2 68.5,35.4 70.0,33.8 70.7,31.9 70.1,29.1 69.1,26.8 66.9,25.0 66.9,25.0 65.5,23.9",
    ],
  },
  {
    id: "forearms",
    label: "Forearms",
    side: "front",
    searchTerms: ["forearms", "brachioradialis", "wrist flexors", "wrist extensors"],
    nameTerms: ["wrist", "forearm", "grip"],
    color: "#7e22ce",
    polygons: [
      "30.1,32.3 30.9,34.5 31.4,36.4 33.8,34.5 36.1,32.9 35.5,35.7 34.8,38.2 33.8,40.8 32.3,42.8 31.2,44.8 29.9,46.3 29.2,47.5 27.4,47.0 25.5,46.7 26.3,44.0 27.0,41.0 27.3,38.8 27.9,36.6 28.6,34.8",
      "64.0,32.4 66.3,34.3 68.5,35.3 70.1,33.7 70.9,32.1 71.9,34.6 72.9,37.4 73.7,40.5 73.9,42.6 74.4,45.0 75.0,46.8 73.5,47.3 70.8,47.6 69.8,45.6 68.8,43.2 67.0,41.3 66.1,39.0 65.2,37.0 65.1,35.4",
    ],
  },
  {
    id: "core",
    label: "Abs / Core",
    side: "front",
    searchTerms: ["abs", "abdominals", "rectus abdominis", "obliques", "core", "transverse abdominis"],
    nameTerms: ["crunch", "plank", "sit up", "sit-up", "ab wheel", "leg raise", "hollow", "bicycle"],
    color: "#0f76c7",
    polygons: [
      "50.1,28.0 48.8,27.6 46.3,28.6 43.5,29.2 40.8,28.8 38.3,27.1 38.0,29.2 39.5,31.9 39.9,34.4 40.1,36.6 39.9,38.5 39.3,40.8 39.6,42.7 41.9,44.6 44.3,46.9 46.9,49.6 48.8,52.2 50.4,53.0 52.1,51.7 53.9,49.6 56.1,47.0 58.3,45.2 60.5,43.4 61.2,41.9 61.0,39.2 60.7,36.8 61.1,33.9 61.7,31.5 62.8,29.2 62.4,27.0 60.7,28.2 58.4,28.8 54.7,28.6 52.4,28.0 50.9,27.0",
    ],
  },
  {
    id: "quads",
    label: "Quads",
    side: "front",
    searchTerms: ["quadriceps", "quads", "vastus lateralis", "vastus medialis", "vastus intermedius"],
    nameTerms: ["squat", "leg press", "leg extension", "lunge", "split squat", "step up", "hack squat"],
    color: "#eab308",
    polygons: [
      "40.7,44.2 40.2,47.2 38.9,50.0 37.6,52.6 37.0,55.2 37.0,58.2 37.4,62.2 38.5,64.9 39.5,67.4 41.2,69.8 44.4,70.7 47.4,69.2 47.8,65.8 47.9,62.3 47.2,58.9 46.1,55.8 44.5,52.8 43.4,50.7 42.5,48.6 41.6,46.2",
      "59.3,44.3 57.4,48.6 55.0,54.0 53.4,58.9 52.3,62.9 52.5,66.1 52.7,68.6 54.8,70.1 58.5,70.3 60.9,67.9 62.6,63.4 63.4,59.4 63.4,55.5 62.2,51.8 60.2,48.1",
    ],
  },
  {
    id: "anterior-tibialis",
    label: "Anterior Tibialis",
    side: "front",
    searchTerms: ["anterior tibialis", "tibialis anterior", "shins", "shin"],
    nameTerms: ["tibialis", "shin", "toe raise", "dorsiflexion"],
    color: "#ec4899",
    polygons: [
      "40.3,72.8 39.7,74.7 39.5,76.5 39.8,78.7 40.0,79.6 40.5,81.2 41.2,82.8 42.3,85.0 42.9,86.7 43.5,87.9 43.6,85.3 43.3,82.8 43.0,80.3 42.9,78.0 42.2,75.7 41.3,74.2",
      "59.8,72.3 60.6,74.2 60.6,77.2 60.0,79.8 59.4,82.2 58.4,84.5 57.4,86.5 56.3,88.3 56.3,86.1 56.9,82.8 57.1,80.7 57.8,77.7 58.2,75.4 59.1,74.0",
    ],
  },
  {
    id: "traps",
    label: "Traps",
    side: "back",
    searchTerms: ["traps", "trapezius", "levator scapulae"],
    nameTerms: ["shrug", "upright row", "face pull"],
    color: "#6d28d9",
    polygons: [
      "36.9,9.3 38.6,11.1 40.4,9.2 41.5,12.4 43.6,14.3 45.9,15.8 48.5,16.5 52.2,17.1 49.1,17.8 46.6,18.9 43.9,19.5 41.3,20.6 39.7,21.9 38.8,23.4 37.7,22.1 35.7,20.5 32.9,19.4 30.3,18.4 27.5,17.7 25.6,17.3 28.4,16.7 31.2,15.8 34.0,14.4 35.4,12.9 36.4,11.0",
    ],
  },
  {
    id: "upper-back",
    label: "Upper Back",
    side: "back",
    searchTerms: ["middle back", "upper back", "rhomboids", "teres major", "teres minor", "rear deltoid"],
    nameTerms: ["row", "face pull", "reverse fly", "rear delt"],
    color: "#f97316",
    polygons: [
      "24.7,17.4 25.9,17.3 29.1,17.9 32.4,19.3 35.5,20.6 37.9,22.0 38.6,23.5 40.4,21.4 42.8,20.2 45.6,19.1 47.7,18.2 49.7,17.6 52.0,17.1 53.9,17.6 51.2,18.2 50.1,18.9 52.0,20.0 53.1,21.6 52.5,23.7 51.9,25.1 49.3,26.0 46.8,26.3 45.3,26.3 43.3,28.8 41.0,31.0 39.6,33.5 38.6,32.9 37.8,33.5 36.3,30.8 33.8,28.4 32.0,26.0 28.8,26.0 26.8,25.8 25.7,25.2 24.5,22.6 24.6,20.9 26.0,19.5 27.4,18.6",
    ],
  },
  {
    id: "lats",
    label: "Lats",
    side: "back",
    searchTerms: ["lats", "latissimus dorsi"],
    nameTerms: ["lat", "pull up", "pullup", "chin up", "pulldown", "pull down"],
    color: "#65a30d",
    polygons: [
      "24.4,25.0 27.2,25.9 29.8,26.0 31.6,26.0 34.0,28.7 36.4,31.0 38.0,33.4 34.7,35.5 32.2,37.6 30.4,39.5 29.5,41.0 27.3,37.4 26.4,34.8 26.0,32.0 24.0,29.9 24.2,27.4",
      "46.3,26.1 50.2,26.1 53.8,25.0 54.0,29.5 52.4,33.2 51.6,35.6 49.4,39.2 48.3,40.6 45.3,37.2 41.8,34.7 40.0,33.2 41.8,30.6 44.6,28.2",
    ],
  },
  {
    id: "triceps",
    label: "Triceps",
    side: "back",
    searchTerms: ["triceps", "triceps brachii"],
    nameTerms: ["tricep", "pushdown", "skull crusher", "extension", "dip"],
    color: "#0ea5e9",
    polygons: [
      "22.7,22.3 18.7,24.1 16.4,25.8 15.7,29.2 14.6,32.1 15.1,35.1 16.5,36.7 20.2,35.8 22.4,33.6 24.2,30.1 24.3,26.3",
      "55.0,22.3 53.6,26.3 54.1,29.9 56.0,33.5 58.6,35.9 61.4,37.0 63.3,33.4 63.1,30.2 62.1,26.6 58.9,24.0",
    ],
  },
  {
    id: "lower-back",
    label: "Lower Back",
    side: "back",
    searchTerms: ["lower back", "erector spinae", "spinal erectors"],
    nameTerms: ["deadlift", "hyperextension", "good morning", "back extension"],
    color: "#db2777",
    polygons: [
      "38.6,33.4 35.5,35.5 32.0,38.8 29.6,42.6 32.8,43.9 36.1,45.7 38.8,48.6 40.9,45.9 44.2,44.0 47.7,42.8 46.3,39.7 44.3,37.1 41.5,34.9",
    ],
  },
  {
    id: "glutes",
    label: "Glutes",
    side: "back",
    searchTerms: ["glutes", "gluteus maximus", "gluteus medius", "gluteus minimus", "abductors"],
    nameTerms: ["glute", "hip thrust", "bridge", "kickback", "bulgarian", "split squat"],
    color: "#eab308",
    polygons: [
      "38.7,48.6 36.3,45.5 33.4,44.1 29.0,42.6 27.5,44.4 26.3,47.8 25.5,50.9 25.4,52.8 26.8,55.4 28.5,56.2 32.2,56.1 35.3,55.9 37.7,54.5 38.7,53.4 39.8,54.8 42.2,55.9 45.7,56.1 48.4,55.9 51.3,55.0 51.8,53.1 51.7,49.9 50.7,46.6 49.7,44.6 48.4,42.7 45.3,43.7 42.4,45.0 41.0,46.0",
    ],
  },
  {
    id: "hamstrings",
    label: "Hamstrings",
    side: "back",
    searchTerms: ["hamstrings", "biceps femoris", "semitendinosus", "semimembranosus"],
    nameTerms: ["leg curl", "romanian deadlift", "rdl", "good morning", "deadlift", "hamstring"],
    color: "#7e22ce",
    polygons: [
      "25.3,55.3 27.9,56.1 33.7,55.8 37.1,55.3 38.3,56.9 36.9,60.6 36.1,64.6 35.8,68.9 34.1,73.9 31.6,71.8 27.9,69.7 25.7,71.9 25.8,68.3 24.5,65.5 24.1,61.4 24.4,58.3",
      "40.0,54.7 43.8,55.8 50.1,56.0 52.9,55.4 53.7,60.2 53.0,64.1 52.1,67.9 52.1,72.0 49.8,69.6 47.0,71.1 43.9,74.2 42.2,71.3 42.4,67.3 41.8,64.1 40.4,59.8 39.8,57.1",
    ],
  },
  {
    id: "calves-back",
    label: "Calves",
    side: "back",
    searchTerms: ["calves", "soleus", "gastrocnemius"],
    nameTerms: ["calf"],
    color: "#0d9488",
    polygons: [
      "27.7,69.9 29.6,72.3 31.1,71.6 33.8,74.0 35.4,79.8 34.0,83.4 33.3,88.7 32.6,92.6 32.3,94.3 29.9,94.3 28.1,91.1 27.4,87.3 25.6,84.0 25.6,82.1 24.7,77.7 26.1,73.4",
      "48.1,72.4 46.9,71.3 43.4,74.3 42.7,78.7 42.7,81.1 43.6,83.4 44.5,87.9 45.6,91.1 45.7,93.7 47.6,94.4 49.7,91.2 50.8,87.8 52.0,84.2 52.7,81.5 53.5,78.4 52.1,75.1 52.0,72.0 50.6,70.0",
    ],
  },
];

const DEFAULT_REGION_ID = "glutes";

function transformPolygon(points: string, offset?: TraceOffset): string {
  if (!offset || (offset.dx === 0 && offset.dy === 0)) return points;
  return points
    .split(/\s+/)
    .map((pair) => {
      const [xRaw, yRaw] = pair.split(",");
      const x = parseFloat(xRaw ?? "");
      const y = parseFloat(yRaw ?? "");
      if (Number.isNaN(x) || Number.isNaN(y)) return pair;
      return `${(x + offset.dx).toFixed(1)},${(y + offset.dy).toFixed(1)}`;
    })
    .join(" ");
}

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
  side,
  selectedRegionId,
  onSelect,
}: {
  side: "front" | "back";
  selectedRegionId: string;
  onSelect: (id: string) => void;
}) {
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [traceEnabled, setTraceEnabled] = useState(false);
  const [traceRegionId, setTraceRegionId] = useState<string>("");
  const [tracePoints, setTracePoints] = useState<TracePoint[]>([]);
  const [traceOffsets, setTraceOffsets] = useState<Record<string, TraceOffset>>({});
  const image = side === "front"
    ? { src: "/body-image-front.png", width: 765, height: 1024, alt: "Front muscle groups", maxWidth: "24rem" }
    : { src: "/body-image-back.png", width: 638, height: 1024, alt: "Back muscle groups", maxWidth: "21.2rem" };
  const visibleRegions = useMemo(() => REGIONS.filter((region) => region.side === side), [side]);
  const traceOutput = tracePoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const traceRegion = visibleRegions.find((region) => region.id === traceRegionId);
  const adjustedRegionOutput =
    traceRegion?.polygons
      .map((points) => `"${transformPolygon(points, traceOffsets[traceRegion.id])}"`)
      .join(",\n") ?? "";

  function addTracePoint(clientX: number, clientY: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setTracePoints((points) => [...points, { x, y }]);
  }

  function nudgeTraceRegion(dx: number, dy: number) {
    if (!traceRegionId) return;
    setTracePoints([]);
    setTraceOffsets((offsets) => {
      const current = offsets[traceRegionId] ?? { dx: 0, dy: 0 };
      return {
        ...offsets,
        [traceRegionId]: {
          dx: Math.round((current.dx + dx) * 10) / 10,
          dy: Math.round((current.dy + dy) * 10) / 10,
        },
      };
    });
  }

  function resetTraceRegionOffset() {
    if (!traceRegionId) return;
    setTraceOffsets((offsets) => {
      const next = { ...offsets };
      delete next[traceRegionId];
      return next;
    });
  }

  useEffect(() => {
    const enabled =
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("traceMuscles") === "1";
    setTraceEnabled(enabled);
  }, []);

  useEffect(() => {
    const firstRegionId = REGIONS.find((region) => region.side === side)?.id ?? "";
    setTraceRegionId(firstRegionId);
    setTracePoints([]);
  }, [side]);

  return (
    <div className="mx-auto">
      <div
        className="relative overflow-hidden rounded-xl border border-stone-200 bg-stone-950"
        style={{ maxWidth: image.maxWidth }}
      >
        {/* Native image keeps the anatomy looking polished; SVG overlays keep it interactive. */}
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          className="block h-auto w-full select-none"
          draggable={false}
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-label={`${side} clickable muscle groups`}
          onPointerDownCapture={(e) => {
            if (!traceEnabled) return;
            e.preventDefault();
            e.stopPropagation();
            addTracePoint(e.clientX, e.clientY, e.currentTarget);
          }}
        >
          {visibleRegions.flatMap((region) => {
            const selected = region.id === selectedRegionId;
            const hovered = region.id === hoveredRegionId;
            const alwaysFilled = region.id === "anterior-tibialis";
            return region.polygons.map((points, index) => (
              <g key={`${region.id}-${index}`}>
                {alwaysFilled && (
                  <polygon
                    points={transformPolygon(points, traceOffsets[region.id])}
                    fill="#ffffff"
                    fillOpacity={0.35}
                    stroke="#ffffff"
                    strokeOpacity={selected || hovered ? 0.95 : 0.55}
                    strokeWidth={selected || hovered ? 1.1 : 0.8}
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none"
                  />
                )}
                <polygon
                  points={transformPolygon(points, traceOffsets[region.id])}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!traceEnabled) onSelect(region.id);
                  }}
                  onMouseEnter={() => setHoveredRegionId(region.id)}
                  onMouseLeave={() => setHoveredRegionId(null)}
                  onFocus={() => setHoveredRegionId(region.id)}
                  onBlur={() => setHoveredRegionId(null)}
                  onKeyDown={(e: KeyboardEvent<SVGPolygonElement>) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(region.id);
                    }
                  }}
                  fill={region.color}
                  fillOpacity={selected ? 0.68 : hovered ? 0.6 : alwaysFilled ? 0.56 : 0.02}
                  stroke={region.color}
                  strokeOpacity={selected ? 1 : hovered ? 0.95 : alwaysFilled ? 0.8 : 0}
                  strokeWidth={selected || hovered ? 0.75 : alwaysFilled ? 0.6 : 0.45}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer outline-none transition-opacity"
                  aria-label={region.label}
                >
                  <title>{region.label}</title>
                </polygon>
              </g>
            ));
          })}
          {tracePoints.length > 0 && (
            <>
              <polyline
                points={traceOutput}
                fill="none"
                stroke="#a2f4b1"
                strokeWidth={0.7}
                vectorEffect="non-scaling-stroke"
              />
              {tracePoints.map((point, index) => (
                <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={1.2} fill="#a2f4b1" />
              ))}
            </>
          )}
        </svg>
      </div>

      {traceEnabled && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Trace mode</span>
            <select
              value={traceRegionId}
              onChange={(e) => {
                setTraceRegionId(e.target.value);
                setTracePoints([]);
              }}
              className="rounded border border-amber-300 bg-white px-2 py-1"
            >
              {visibleRegions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setTracePoints((points) => points.slice(0, -1))}
              className="rounded border border-amber-300 bg-white px-2 py-1"
            >
              Undo point
            </button>
            <button
              type="button"
              onClick={() => setTracePoints([])}
              className="rounded border border-amber-300 bg-white px-2 py-1"
            >
              Clear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-semibold">Nudge selected:</span>
            <button type="button" onClick={() => nudgeTraceRegion(0, -0.5)} className="rounded border border-amber-300 bg-white px-2 py-1">
              Up
            </button>
            <button type="button" onClick={() => nudgeTraceRegion(0, 0.5)} className="rounded border border-amber-300 bg-white px-2 py-1">
              Down
            </button>
            <button type="button" onClick={() => nudgeTraceRegion(-0.5, 0)} className="rounded border border-amber-300 bg-white px-2 py-1">
              Left
            </button>
            <button type="button" onClick={() => nudgeTraceRegion(0.5, 0)} className="rounded border border-amber-300 bg-white px-2 py-1">
              Right
            </button>
            <button type="button" onClick={resetTraceRegionOffset} className="rounded border border-amber-300 bg-white px-2 py-1">
              Reset nudge
            </button>
            <button type="button" onClick={() => setTraceOffsets({})} className="rounded border border-amber-300 bg-white px-2 py-1">
              Reset all nudges
            </button>
          </div>
          <p className="mt-2">Click around a muscle boundary, or nudge the existing shape. Copy this into that region&apos;s `polygons` array:</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-[11px] text-stone-800">
            {traceOutput ? `\"${traceOutput}\"` : adjustedRegionOutput || "No points yet"}
          </code>
          <p className="mt-1 text-amber-800">Current region: {traceRegionId || "none"}</p>
        </div>
      )}
    </div>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,1.05fr)]">
        <BodyMapImage side={side} selectedRegionId={selectedRegionId} onSelect={selectRegion} />
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
