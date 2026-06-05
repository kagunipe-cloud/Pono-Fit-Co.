import { randomUUID } from "crypto";
import type { getDb } from "./db";
import {
  ensureRecurringClassesTables,
  ensureClassesRecurringColumns,
} from "./recurring-classes";
import {
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
  OPEN_GROUP_MAX_PARTICIPANTS,
  SESSION_KIND_OPEN_GROUP_PT,
  SMALL_GROUP_PT_DISPLAY_NAME,
} from "./open-group-pt";
import { isPTBookingSlotFree } from "./schedule-conflicts";
import { timeToMinutes } from "./pt-slots";

export function ensureClassesSessionKindColumns(db: ReturnType<typeof getDb>) {
  ensureClassesRecurringColumns(db);
  try {
    db.exec("ALTER TABLE classes ADD COLUMN session_kind TEXT DEFAULT 'standard'");
  } catch {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE classes ADD COLUMN flat_session_price TEXT");
  } catch {
    /* exists */
  }
}

/** One-off class + occurrence for a member-started Small-Group PT slot. */
export function createSmallGroupPtOccurrence(
  db: ReturnType<typeof getDb>,
  opts: {
    occurrence_date: string;
    occurrence_time: string;
    duration_minutes: number;
    trainer_member_id?: string | null;
  }
): number {
  ensureRecurringClassesTables(db);
  ensureClassesSessionKindColumns(db);

  const time = opts.occurrence_time.trim().slice(0, 5);
  const cap = OPEN_GROUP_MAX_PARTICIPANTS;
  const product_id = `sgpt-${randomUUID().slice(0, 12)}`;

  const classResult = db
    .prepare(
      `INSERT INTO classes (
        product_id, class_name, instructor, trainer_member_id, date, time, capacity, status, price,
        stripe_link, category, description, image_url, is_recurring, days_of_week, duration_minutes,
        session_kind, flat_session_price
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'Open', '0', NULL, 'PT', NULL, NULL, 0, NULL, ?, ?, ?)`
    )
    .run(
      product_id,
      SMALL_GROUP_PT_DISPLAY_NAME,
      opts.trainer_member_id?.trim() || null,
      opts.occurrence_date,
      time,
      cap,
      opts.duration_minutes,
      SESSION_KIND_OPEN_GROUP_PT,
      OPEN_GROUP_DEFAULT_FLAT_PRICE
    );

  const classId = classResult.lastInsertRowid as number;
  const occ = db
    .prepare(
      `INSERT INTO class_occurrences (class_id, occurrence_date, occurrence_time, capacity)
       VALUES (?, ?, ?, ?)`
    )
    .run(classId, opts.occurrence_date, time, cap);

  return occ.lastInsertRowid as number;
}

export function assertSmallGroupPtSlotFree(
  db: ReturnType<typeof getDb>,
  occurrence_date: string,
  start_time: string,
  duration_minutes: number,
  trainer_member_id?: string | null
): void {
  const startMin = timeToMinutes(start_time);
  if (!isPTBookingSlotFree(db, occurrence_date, startMin, duration_minutes, trainer_member_id ?? null)) {
    throw new Error(
      "This time is no longer available. Pick another open slot on the schedule."
    );
  }
  const existing = db
    .prepare(
      `SELECT o.id FROM class_occurrences o
       LEFT JOIN classes c ON c.id = o.class_id
       LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
       WHERE o.occurrence_date = ?
         AND TRIM(o.occurrence_time) = TRIM(?)
         AND (
           COALESCE(c.session_kind, r.session_kind, 'standard') = ?
           OR (o.class_id IS NOT NULL OR o.recurring_class_id IS NOT NULL)
         )`
    )
    .get(occurrence_date, start_time.trim().slice(0, 5), SESSION_KIND_OPEN_GROUP_PT) as { id: number } | undefined;
  if (existing) {
    throw new Error("Something is already scheduled at this time.");
  }
}
