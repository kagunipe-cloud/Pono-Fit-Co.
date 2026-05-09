/**
 * Parser for the community "FitnessDB" / Excel-export style exercise CSV
 * (see repo `FitnessDB/Exercises-Table 1.csv`): preamble rows, then a header row
 * whose columns include Exercise, Target Muscle Group, Prime Mover Muscle, etc.
 */

import type { ExerciseType } from "@/lib/exercise-types";
import { parseExerciseType } from "@/lib/exercise-types";
import { getCanonicalPrimaryMuscles, getMuscleGroup, getMuscleGroupFromCategory } from "@/lib/muscle-groups";

export type FitnessDbExerciseRow = {
  name: string;
  type: ExerciseType;
  primary_muscles: string;
  secondary_muscles: string;
  equipment: string;
  muscle_group: string;
  instructions: string;
};

function normalizeHeaderCell(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse one CSV line respecting quoted fields (aligned with exercises/import route). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        cell += c;
      }
    } else if (c === ",") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  out.push(cell.trim());
  return out;
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/** Skip placeholder / video link cells */
function cleanMuscleCell(s: string): string {
  const t = s.trim().replace(/^"|"$/g, "");
  if (!t || /^video\s+demonstration$/i.test(t) || /^video\s+explanation$/i.test(t)) return "";
  return t;
}

function cleanEquipCell(s: string): string {
  const t = s.trim().replace(/^"|"$/g, "");
  if (!t || /^none$/i.test(t)) return "";
  return t;
}

/**
 * If `csvText` looks like FitnessDB export, returns parsed rows; otherwise [].
 */
export function tryParseFitnessDbCsv(csvText: string): FitnessDbExerciseRow[] {
  const lines = splitCsvLines(csvText.trim());
  let headerRowIdx = -1;
  let headerCells: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const normalized = cells.map((c) => normalizeHeaderCell(c));
    const exIdx = normalized.findIndex((h) => h === "exercise");
    if (exIdx < 0) continue;
    const hasTarget = normalized.some((h) => h.includes("target muscle"));
    if (!hasTarget) continue;
    headerRowIdx = i;
    headerCells = cells;
    break;
  }

  if (headerRowIdx < 0) return [];

  const normHeaders = headerCells.map((c) => normalizeHeaderCell(c));

  const iExercise = normHeaders.findIndex((h) => h === "exercise");
  const iTargetGroup = normHeaders.findIndex((h) => h === "target muscle group" || h.startsWith("target muscle group"));
  const iPrime = normHeaders.findIndex((h) => h === "prime mover muscle");
  const iSec = normHeaders.findIndex((h) => h === "secondary muscle");
  const iTer = normHeaders.findIndex((h) => h === "tertiary muscle");
  const iPrimEq = normHeaders.findIndex((h) => h === "primary equipment");
  const iSecEq = normHeaders.findIndex((h) => h === "secondary equipment");
  const iForce = normHeaders.findIndex((h) => h === "force type");

  if (iExercise < 0) return [];

  const seen = new Set<string>();
  const out: FitnessDbExerciseRow[] = [];

  for (let r = headerRowIdx + 1; r < lines.length; r++) {
    const parts = parseCsvLine(lines[r]);
    const name = (parts[iExercise] ?? "").trim().replace(/^"|"$/g, "");
    if (!name) continue;

    const targetGroupRaw = iTargetGroup >= 0 ? cleanMuscleCell(parts[iTargetGroup] ?? "") : "";
    const prime = iPrime >= 0 ? cleanMuscleCell(parts[iPrime] ?? "") : "";
    const sec = iSec >= 0 ? cleanMuscleCell(parts[iSec] ?? "") : "";
    const ter = iTer >= 0 ? cleanMuscleCell(parts[iTer] ?? "") : "";
    const secondaryParts = [sec, ter].filter(Boolean);
    const primary_muscles = prime || targetGroupRaw;
    const secondary_muscles = secondaryParts.join(", ");

    let equip = iPrimEq >= 0 ? cleanEquipCell(parts[iPrimEq] ?? "") : "";
    const eq2 = iSecEq >= 0 ? cleanEquipCell(parts[iSecEq] ?? "") : "";
    if (eq2) equip = equip ? `${equip}, ${eq2}` : eq2;

    const forceRaw = iForce >= 0 ? (parts[iForce] ?? "").trim().toLowerCase() : "";
    const cardioHint = /\baerobic\b|\bcardio\b|\bconditioning\b/i.test(forceRaw) || /\b(rowing|treadmill|bike|elliptical|running)\b/i.test(name);

    const type = cardioHint ? parseExerciseType("cardio") : parseExerciseType("lift");

    const canonical = getCanonicalPrimaryMuscles(name);
    const primaryForGroup = canonical ?? primary_muscles;

    const fromTargetCategory = getMuscleGroupFromCategory(targetGroupRaw || undefined);
    const muscle_group = fromTargetCategory ?? getMuscleGroup(primaryForGroup || undefined, name);

    const key = `${name.toLowerCase()}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const instructions = ""; // FitnessDB export uses video columns, not step text

    out.push({
      name,
      type,
      primary_muscles: primaryForGroup,
      secondary_muscles,
      equipment: equip,
      muscle_group,
      instructions,
    });
  }

  return out;
}
