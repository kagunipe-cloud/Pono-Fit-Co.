import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import {
  GYM_RECORD_AGE_BRACKETS,
  GYM_RECORD_EVENTS,
  GYM_RECORD_GENDERS,
  GYM_RECORD_PLACES,
  GYM_RECORD_TV_PAGES,
  GYM_SPECIAL_RECORDS,
  getGymRecordsGrid,
  getGymSpecialRecordsGrid,
  gridToCells,
  saveGymRecords,
  saveGymSpecialRecords,
  specialGridToCells,
  type GymRecordCell,
  type GymRecordsGrid,
  type GymSpecialRecordsGrid,
} from "@/lib/gym-records";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const records = getGymRecordsGrid(db);
    const special = getGymSpecialRecordsGrid(db);
    db.close();
    return NextResponse.json({
      age_brackets: GYM_RECORD_AGE_BRACKETS,
      genders: GYM_RECORD_GENDERS,
      events: GYM_RECORD_EVENTS,
      places: GYM_RECORD_PLACES,
      tv_pages: GYM_RECORD_TV_PAGES,
      special_records: GYM_SPECIAL_RECORDS,
      records,
      special,
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

    const hasRecords = body.records && typeof body.records === "object" && !Array.isArray(body.records);
    const hasCells = Array.isArray(body.cells);
    const hasSpecial = body.special && typeof body.special === "object" && !Array.isArray(body.special);

    if (!hasRecords && !hasCells && !hasSpecial) {
      db.close();
      return NextResponse.json(
        { error: "Send { records: grid }, { cells: [...] }, and/or { special: grid }." },
        { status: 400 }
      );
    }

    if (hasRecords) {
      saveGymRecords(db, gridToCells(body.records as GymRecordsGrid));
    } else if (hasCells) {
      saveGymRecords(db, body.cells as GymRecordCell[]);
    }
    if (hasSpecial) {
      saveGymSpecialRecords(db, specialGridToCells(body.special as GymSpecialRecordsGrid));
    }

    const records = getGymRecordsGrid(db);
    const special = getGymSpecialRecordsGrid(db);
    db.close();

    return NextResponse.json({ ok: true, records, special });
  } catch (err) {
    console.error("[admin/gym-records PATCH]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save gym records." }, { status: 500 });
  }
}
