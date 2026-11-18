import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import {
  csvRow,
  headerIndex,
  parseCsvHeaderRow,
  parseCsvLine,
  splitCsvLines,
  splitMuscleCell,
} from "@/lib/exercise-csv";
import { joinMuscleCsv } from "@/lib/exercise-muscle-vocabulary";
import { parseMovementClass } from "@/lib/exercise-movement-class";
import { getMuscleGroup, MUSCLE_GROUP_LABELS } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

const EXPORT_COLUMNS = [
  "id",
  "name",
  "type",
  "muscle_group",
  "movement_class",
  "primary_muscles",
  "secondary_muscles",
  "antagonist_muscles",
  "equipment",
] as const;

/**
 * GET — export exercises as CSV for Excel/Sheets (edit muscles, re-import by id).
 */
export async function GET(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const db = getDb();
    ensureWorkoutTables(db);
    const rows = db
      .prepare(
        `SELECT id, name, type, muscle_group, movement_class, primary_muscles, secondary_muscles, antagonist_muscles, equipment
         FROM exercises ORDER BY name COLLATE NOCASE`
      )
      .all() as {
      id: number;
      name: string;
      type: string;
      muscle_group: string | null;
      movement_class: string | null;
      primary_muscles: string | null;
      secondary_muscles: string | null;
      antagonist_muscles: string | null;
      equipment: string | null;
    }[];
    db.close();

    const lines = [csvRow([...EXPORT_COLUMNS])];
    for (const r of rows) {
      lines.push(
        csvRow([
          String(r.id),
          r.name,
          r.type,
          r.muscle_group ?? "",
          r.movement_class ?? "",
          r.primary_muscles ?? "",
          r.secondary_muscles ?? "",
          r.antagonist_muscles ?? "",
          r.equipment ?? "",
        ])
      );
    }
    const body = "\uFEFF" + lines.join("\r\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="exercises-muscle-edit.csv"',
      },
    });
  } catch (err) {
    console.error("[exercises/spreadsheet] export", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

type UpdateRowResult = { id: number; ok: boolean; error?: string };

/**
 * POST — update existing exercises from CSV (match by id). Does not create new rows.
 * Body: { csv: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as { csv?: string };
    const raw = typeof body.csv === "string" ? body.csv.trim() : "";
    if (!raw) return NextResponse.json({ error: "Paste or send { csv: \"...\" }" }, { status: 400 });

    const lines = splitCsvLines(raw.replace(/^\uFEFF/, ""));
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV needs a header row and at least one data row" }, { status: 400 });
    }

    const headers = parseCsvHeaderRow(lines[0]!);
    const idIdx = headerIndex(headers, "id");
    if (idIdx < 0) {
      return NextResponse.json({ error: "CSV must include an id column" }, { status: 400 });
    }

    const muscleGroupIdx = headerIndex(headers, "muscle_group", "muscle group");
    const movementIdx = headerIndex(headers, "movement_class", "movement class");
    const primaryIdx = headerIndex(headers, "primary_muscles", "primary muscles", "target muscle", "target_muscles");
    const secondaryIdx = headerIndex(headers, "secondary_muscles", "secondary muscles", "synergist", "synergistic");
    const antagonistIdx = headerIndex(headers, "antagonist_muscles", "antagonist muscles", "antagonist");
    const equipmentIdx = headerIndex(headers, "equipment");

    const editableColumns =
      muscleGroupIdx >= 0 ||
      movementIdx >= 0 ||
      primaryIdx >= 0 ||
      secondaryIdx >= 0 ||
      antagonistIdx >= 0 ||
      equipmentIdx >= 0;
    if (!editableColumns) {
      return NextResponse.json(
        { error: "Include at least one editable column (primary_muscles, secondary_muscles, etc.)" },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const getPrev = db.prepare(
      `SELECT id, name, type, muscle_group, movement_class, primary_muscles, secondary_muscles, antagonist_muscles, equipment
       FROM exercises WHERE id = ?`
    );
    const update = db.prepare(
      `UPDATE exercises SET
        muscle_group = ?,
        movement_class = ?,
        primary_muscles = ?,
        secondary_muscles = ?,
        antagonist_muscles = ?,
        equipment = ?,
        muscles_enriched_at = NULL,
        muscles_enrich_confidence = NULL
      WHERE id = ?`
    );

    const results: UpdateRowResult[] = [];
    let updated = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]!);
      const idRaw = (parts[idIdx] ?? "").replace(/^"|"$/g, "").trim();
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) {
        skipped++;
        continue;
      }

      const prev = getPrev.get(id) as
        | {
            id: number;
            name: string;
            type: string;
            muscle_group: string | null;
            movement_class: string | null;
            primary_muscles: string | null;
            secondary_muscles: string | null;
            antagonist_muscles: string | null;
            equipment: string | null;
          }
        | undefined;
      if (!prev) {
        results.push({ id, ok: false, error: "not found" });
        skipped++;
        continue;
      }

      const cell = (idx: number) =>
        idx >= 0 ? (parts[idx] ?? "").trim().replace(/^"|"$/g, "") : "";

      if (primaryIdx >= 0) {
        const primaryRaw = cell(primaryIdx);
        const normalized = joinMuscleCsv(splitMuscleCell(primaryRaw));
        if (primaryRaw && !normalized) {
          results.push({ id, ok: false, error: "primary_muscles not recognized (check spelling)" });
          skipped++;
          continue;
        }
      }

      const nextPrimary =
        primaryIdx >= 0 ? joinMuscleCsv(splitMuscleCell(cell(primaryIdx))) : prev.primary_muscles ?? "";
      const nextSecondary =
        secondaryIdx >= 0 ? joinMuscleCsv(splitMuscleCell(cell(secondaryIdx))) : prev.secondary_muscles ?? "";
      const nextAntagonist =
        antagonistIdx >= 0 ? joinMuscleCsv(splitMuscleCell(cell(antagonistIdx))) : prev.antagonist_muscles ?? "";
      const nextEquipment = equipmentIdx >= 0 ? cell(equipmentIdx) : prev.equipment ?? "";

      let nextMuscleGroup = prev.muscle_group ?? "core";
      if (muscleGroupIdx >= 0) {
        const g = cell(muscleGroupIdx).toLowerCase();
        if (g && MUSCLE_GROUP_LABELS.includes(g as (typeof MUSCLE_GROUP_LABELS)[number])) {
          nextMuscleGroup = g;
        }
      } else if (primaryIdx >= 0) {
        nextMuscleGroup = getMuscleGroup(nextPrimary || undefined, prev.name) ?? nextMuscleGroup;
      }

      const nextMovement =
        movementIdx >= 0
          ? parseMovementClass(cell(movementIdx), prev.type)
          : parseMovementClass(prev.movement_class, prev.type);

      const same =
        nextMuscleGroup === (prev.muscle_group ?? "core") &&
        (nextMovement ?? "") === (prev.movement_class ?? "") &&
        nextPrimary === (prev.primary_muscles ?? "") &&
        nextSecondary === (prev.secondary_muscles ?? "") &&
        nextAntagonist === (prev.antagonist_muscles ?? "") &&
        nextEquipment === (prev.equipment ?? "");
      if (same) {
        skipped++;
        continue;
      }

      update.run(nextMuscleGroup, nextMovement, nextPrimary, nextSecondary, nextAntagonist, nextEquipment, id);
      updated++;
      results.push({ id, ok: true });
    }

    db.close();

    return NextResponse.json({
      updated,
      skipped,
      total_rows: lines.length - 1,
      errors: results.filter((r) => !r.ok).slice(0, 40),
    });
  } catch (err) {
    console.error("[exercises/spreadsheet] import", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}