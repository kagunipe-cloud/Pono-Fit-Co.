import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import {
  GYM_RECORD_AGE_BRACKETS,
  GYM_RECORD_EVENTS,
  GYM_RECORD_GENDERS,
  getGymRecordsGrid,
  gridToCells,
  saveGymRecords,
  type GymRecordCell,
  type GymRecordsGrid,
} from "@/lib/gym-records";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const records = getGymRecordsGrid(db);
    db.close();
    return NextResponse.json({
      age_brackets: GYM_RECORD_AGE_BRACKETS,
      genders: GYM_RECORD_GENDERS,
      events: GYM_RECORD_EVENTS,
      records,
    });
  } catch (err) {
    console.error("[admin/gym-records GET]", err);
    return NextResponse.json({ error: "Failed to load gym records." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const db = getDb();

    let cells: GymRecordCell[] = [];
    if (body.records && typeof body.records === "object" && !Array.isArray(body.records)) {
      cells = gridToCells(body.records as GymRecordsGrid);
    } else if (Array.isArray(body.cells)) {
      cells = body.cells as GymRecordCell[];
    } else {
      db.close();
      return NextResponse.json({ error: "Send { records: grid } or { cells: [...] }." }, { status: 400 });
    }

    saveGymRecords(db, cells);
    const records = getGymRecordsGrid(db);
    db.close();

    return NextResponse.json({ ok: true, records });
  } catch (err) {
    console.error("[admin/gym-records PATCH]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save gym records." }, { status: 500 });
  }
}
