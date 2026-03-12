import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { ensureTrainersTable } from "../../../lib/trainers";

export const dynamic = "force-dynamic";

/** GET — list trainers (member_id, display_name) for dropdowns. Includes everyone in the trainers table plus all Admins (admins count as trainers by default). */
export async function GET() {
  try {
    const db = getDb();
    ensureTrainersTable(db);
    const fromTrainers = db.prepare(`
      SELECT m.member_id, m.first_name, m.last_name, 'trainers' as source
      FROM trainers t
      JOIN members m ON m.member_id = t.member_id
    `).all() as { member_id: string; first_name: string | null; last_name: string | null; source: string }[];
    const fromAdmins = db.prepare(`
      SELECT m.member_id, m.first_name, m.last_name, 'admin' as source
      FROM members m
      WHERE m.role = 'Admin' AND m.member_id NOT IN (SELECT member_id FROM trainers)
    `).all() as { member_id: string; first_name: string | null; last_name: string | null; source: string }[];
    db.close();
    const combined = [...fromTrainers, ...fromAdmins].sort((a, b) => {
      const na = [a.last_name, a.first_name].filter(Boolean).join(" ");
      const nb = [b.last_name, b.first_name].filter(Boolean).join(" ");
      return na.localeCompare(nb);
    });
    const list = combined.map((r) => ({
      member_id: r.member_id,
      display_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
      source: r.source as "trainers" | "admin",
    }));
    return NextResponse.json(list);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch trainers" }, { status: 500 });
  }
}
