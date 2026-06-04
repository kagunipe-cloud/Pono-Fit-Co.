import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getUnavailableInRange } from "../../../../lib/pt-availability";
import { getAdminMemberId, getTrainerMemberId } from "../../../../lib/admin";
import {
  canViewUnavailableHoldDescriptions,
  redactUnavailableOccurrences,
} from "../../../../lib/unavailable-hold-privacy";

export const dynamic = "force-dynamic";

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — Returns expanded unavailable occurrences in range.
 * GET (no params) — Returns raw unavailable_blocks rows (for listing).
 */
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    if (from && to) {
      const staff = await canViewUnavailableHoldDescriptions(request);
      const occurrences = redactUnavailableOccurrences(getUnavailableInRange(from, to), staff);
      return NextResponse.json(occurrences);
    }
    const adminId = await getAdminMemberId(request);
    if (!adminId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare("SELECT * FROM unavailable_blocks ORDER BY recurrence_type, occurrence_date, day_of_week, start_time").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch unavailable blocks" }, { status: 500 });
  }
}

/** POST { trainer?, day_of_week?, start_time, end_time, description, recurrence_type: 'one_time'|'recurring', occurrence_date?, weeks_count? }
 * Admin: full behavior.
 * Trainer (not acting as admin): only **one_time** blocks; `trainer` is forced to their display name (body trainer ignored). */
export async function POST(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    const trainerActorId = await getTrainerMemberId(request);
    if (!adminId && !trainerActorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbAuth = getDb();
    ensurePTSlotTables(dbAuth);
    let trainerNameForced: string | null = null;
    if (!adminId && trainerActorId) {
      const member = dbAuth.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(trainerActorId) as
        | { first_name: string | null; last_name: string | null }
        | undefined;
      trainerNameForced = member ? [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || "Trainer" : "Trainer";
    }
    dbAuth.close();

    const body = await request.json();
    let trainer = (body.trainer ?? "").trim();
    const recurrenceType = (body.recurrence_type ?? "recurring").toString().toLowerCase();
    let isOneTime = recurrenceType === "one_time";

    if (!adminId && trainerActorId) {
      if (!isOneTime) {
        return NextResponse.json({ error: "Trainers can only create one-time unavailable blocks from the schedule" }, { status: 400 });
      }
      trainer = trainerNameForced ?? trainer;
    }

    const isTrainerOnly = !adminId && !!trainerActorId;
    const start_time = (body.start_time ?? "12:00").toString().trim();
    const end_time = (body.end_time ?? "13:00").toString().trim();
    const rawDesc = (body.description ?? "").toString().trim();
    if (adminId && rawDesc.length < 2) {
      return NextResponse.json({ error: "Description is required for blocked-off time (at least 2 characters)." }, { status: 400 });
    }
    if (isTrainerOnly && rawDesc.length < 2) {
      return NextResponse.json({ error: "Description is required for a hold (at least 2 characters)." }, { status: 400 });
    }
    const description = rawDesc;

    let day_of_week: number;
    let occurrence_date: string | null = null;
    let weeks_count: number | null = null;

    if (isOneTime) {
      occurrence_date = (body.occurrence_date ?? "").toString().trim();
      if (!occurrence_date || !/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date)) {
        return NextResponse.json({ error: "occurrence_date (YYYY-MM-DD) required for one-time blocks" }, { status: 400 });
      }
      const d = new Date(occurrence_date + "T12:00:00");
      day_of_week = d.getDay();
    } else {
      day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 0), 10)));
      occurrence_date = (body.occurrence_date ?? "").toString().trim() || null;
      if (!occurrence_date) {
        const today = new Date();
        occurrence_date = today.toISOString().slice(0, 10);
      }
      const wc = body.weeks_count;
      if (wc !== undefined && wc !== null && wc !== "") {
        const n = parseInt(String(wc), 10);
        if (!Number.isNaN(n) && n > 0) weeks_count = n;
      }
    }

    const db = getDb();
    ensurePTSlotTables(db);
    if (isTrainerOnly && !trainer.trim()) {
      db.close();
      return NextResponse.json({ error: "Could not resolve trainer name" }, { status: 400 });
    }
    const result = db.prepare(
      "INSERT INTO unavailable_blocks (trainer, day_of_week, start_time, end_time, description, recurrence_type, occurrence_date, weeks_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(trainer, day_of_week, start_time, end_time, description, isOneTime ? "one_time" : "recurring", occurrence_date, weeks_count);
    const row = db.prepare("SELECT * FROM unavailable_blocks WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create unavailable block" }, { status: 500 });
  }
}
