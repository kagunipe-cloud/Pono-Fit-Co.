import type Database from "better-sqlite3";
import { timeToMinutes, minutesToTime } from "./pt-slots";

type AvailRow = {
  id: number;
  trainer: string;
  trainer_member_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  description: string | null;
  days_of_week: string | null;
};

function trainerKey(r: AvailRow): string {
  const id = (r.trainer_member_id ?? "").trim();
  if (id !== "") return `m:${id}`;
  return `n:${r.trainer.trim().toLowerCase()}`;
}

function dayPatternKey(r: AvailRow): string {
  const d = (r.days_of_week ?? "").trim();
  if (d !== "") {
    const parts = d
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => n >= 0 && n <= 6);
    const sorted = [...new Set(parts)].sort((a, b) => a - b);
    return `multi:${sorted.join(",")}`;
  }
  return `dow:${r.day_of_week}`;
}

function groupKey(r: AvailRow): string {
  return `${trainerKey(r)}|${dayPatternKey(r)}`;
}

/**
 * Merge availability rows that are end-to-end contiguous (end time of one === start time of next)
 * for the same trainer and same weekly pattern. Repoints `pt_trainer_specific_bookings` to the
 * surviving row (lowest id), deletes absorbed rows, expands the survivor's interval.
 *
 * @returns Map from absorbed/deleted row id → surviving `trainer_availability.id` (for API responses when an inserted id was merged away).
 */
export function mergeTouchingTrainerAvailability(
  db: Database.Database,
  scope?: { trainerMemberId?: string | null; legacyTrainerName?: string | null }
): Map<number, number> {
  const idToSurvivor = new Map<number, number>();
  const where: string[] = [];
  const params: unknown[] = [];
  const member = scope?.trainerMemberId != null ? String(scope.trainerMemberId).trim() : "";
  if (member !== "") {
    where.push("trainer_member_id = ?");
    params.push(member);
  } else if (scope?.legacyTrainerName != null && String(scope.legacyTrainerName).trim() !== "") {
    where.push("(trainer_member_id IS NULL OR TRIM(trainer_member_id) = '') AND TRIM(trainer) = ?");
    params.push(String(scope.legacyTrainerName).trim());
  }

  const sql =
    "SELECT id, trainer, trainer_member_id, day_of_week, start_time, end_time, description, days_of_week FROM trainer_availability" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY day_of_week, days_of_week, start_time, id";

  const allRows = db.prepare(sql).all(...params) as AvailRow[];
  const byGroup = new Map<string, AvailRow[]>();
  for (const r of allRows) {
    const k = groupKey(r);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(r);
  }

  type Plan = {
    survivor: AvailRow;
    absorb: AvailRow[];
    mergedStart: number;
    mergedEnd: number;
    description: string | null;
  };
  const mergePlans: Plan[] = [];

  for (const rows of byGroup.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort(
      (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time) || a.id - b.id
    );
    const n = sorted.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(i: number): number {
      if (parent[i] !== i) parent[i] = find(parent[i]);
      return parent[i];
    }
    function union(i: number, j: number) {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
    for (let i = 0; i < n - 1; i++) {
      if (timeToMinutes(sorted[i].end_time) === timeToMinutes(sorted[i + 1].start_time)) {
        union(i, i + 1);
      }
    }
    const comps = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!comps.has(root)) comps.set(root, []);
      comps.get(root)!.push(i);
    }
    for (const indices of comps.values()) {
      if (indices.length < 2) continue;
      const subset = indices.map((i) => sorted[i]);
      const survivor = subset.reduce((a, b) => (a.id < b.id ? a : b));
      const absorb = subset.filter((r) => r.id !== survivor.id);
      const mergedStart = Math.min(...subset.map((r) => timeToMinutes(r.start_time)));
      const mergedEnd = Math.max(...subset.map((r) => timeToMinutes(r.end_time)));
      const descs = [...new Set(subset.map((r) => (r.description ?? "").trim()).filter(Boolean))];
      const description = descs.length === 0 ? null : descs.join(" · ");
      mergePlans.push({ survivor, absorb, mergedStart, mergedEnd, description });
    }
  }

  if (mergePlans.length === 0) return idToSurvivor;

  const repoint = db.prepare(
    "UPDATE pt_trainer_specific_bookings SET trainer_availability_id = ? WHERE trainer_availability_id = ?"
  );
  const delAvail = db.prepare("DELETE FROM trainer_availability WHERE id = ?");
  const updAvail = db.prepare(
    "UPDATE trainer_availability SET start_time = ?, end_time = ?, description = ? WHERE id = ?"
  );

  const tx = db.transaction(() => {
    for (const plan of mergePlans) {
      const sId = plan.survivor.id;
      for (const row of plan.absorb) {
        repoint.run(sId, row.id);
        idToSurvivor.set(row.id, sId);
        delAvail.run(row.id);
      }
      updAvail.run(minutesToTime(plan.mergedStart), minutesToTime(plan.mergedEnd), plan.description, sId);
    }
  });
  tx();

  return idToSurvivor;
}

/** Resolve an id after merge (inserted or updated row may have been absorbed into an older id). */
export function resolveAvailabilityIdAfterMerge(
  id: number | bigint,
  absorbedIdToSurvivor: Map<number, number>
): number {
  let cur = typeof id === "bigint" ? Number(id) : id;
  const seen = new Set<number>();
  while (absorbedIdToSurvivor.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = absorbedIdToSurvivor.get(cur)!;
  }
  return cur;
}
