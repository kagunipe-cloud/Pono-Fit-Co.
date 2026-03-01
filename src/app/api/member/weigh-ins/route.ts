import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET — weigh-ins for the member. Query: date=YYYY-MM-DD (single day) OR from= & to= (range, for chart). */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();

    const db = getDb();
    ensureJournalTables(db);

    if (date) {
      const row = db.prepare(
        "SELECT date, weight FROM member_weigh_ins WHERE member_id = ? AND date = ?"
      ).get(memberId, date) as { date: string; weight: number } | undefined;
      db.close();
      return NextResponse.json({ date, weight: row?.weight ?? null });
    }

    if (from && to) {
      const rows = db.prepare(
        "SELECT date, weight FROM member_weigh_ins WHERE member_id = ? AND date >= ? AND date <= ? ORDER BY date ASC"
      ).all(memberId, from, to) as { date: string; weight: number }[];
      db.close();
      return NextResponse.json({ weigh_ins: rows });
    }

    db.close();
    return NextResponse.json({ error: "Provide date= or from= and to=" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get weigh-ins" }, { status: 500 });
  }
}

/** PATCH — set or clear weight for a day. Body: { date: "YYYY-MM-DD", weight: number | null }. */
export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
    }
    const weight = body.weight === null || body.weight === undefined
      ? null
      : typeof body.weight === "number" && body.weight > 0 ? body.weight : Number(body.weight);
    if (weight !== null && (typeof weight !== "number" || Number.isNaN(weight) || weight <= 0)) {
      return NextResponse.json({ error: "weight must be a positive number or null to clear" }, { status: 400 });
    }

    const db = getDb();
    ensureJournalTables(db);

    if (weight == null) {
      db.prepare("DELETE FROM member_weigh_ins WHERE member_id = ? AND date = ?").run(memberId, date);
    } else {
      db.prepare(
        "INSERT INTO member_weigh_ins (member_id, date, weight) VALUES (?, ?, ?) ON CONFLICT(member_id, date) DO UPDATE SET weight = excluded.weight"
      ).run(memberId, date, weight);
    }
    db.close();

    return NextResponse.json({ ok: true, date, weight });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update weigh-in" }, { status: 500 });
  }
}
