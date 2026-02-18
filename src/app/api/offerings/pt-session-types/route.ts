import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

type ProductRow = { id: number; session_name: string; trainer: string | null; price: string; duration_minutes: number | null; description: string | null };

/** Returns PT session products (date_time IS NULL) — bookable into any slot. Recurring/scheduled sessions (with date_time) are not shown. */
export async function GET() {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const products = db
      .prepare(
        `SELECT id, session_name, trainer, price, duration_minutes, description
         FROM pt_sessions
         WHERE date_time IS NULL
         ORDER BY session_name ASC, COALESCE(trainer, ''), duration_minutes ASC`
      )
      .all() as ProductRow[];
    const trainerDescriptions = db
      .prepare(
        `SELECT trainer, description FROM trainer_availability WHERE description IS NOT NULL AND description != ''`
      )
      .all() as { trainer: string; description: string }[];
    const descByTrainer = new Map<string, string>();
    for (const r of trainerDescriptions) {
      if (!descByTrainer.has(r.trainer)) descByTrainer.set(r.trainer, r.description);
    }
    const types = products.map((p) => {
      const description = (p.description && p.description.trim()) ? p.description.trim() : (p.trainer ? descByTrainer.get(p.trainer) ?? null : null);
      return {
        id: p.id,
        session_name: p.session_name,
        trainer: p.trainer,
        price: p.price,
        duration_minutes: p.duration_minutes ?? 60,
        description: description || null,
      };
    });
    const singleCreditPack = db
      .prepare("SELECT id, price FROM pt_pack_products WHERE credits = 1 ORDER BY id LIMIT 1")
      .get() as { id: number; price: string } | undefined;
    db.close();
    return NextResponse.json({
      types,
      singleCreditPack: singleCreditPack ? { id: singleCreditPack.id, price: singleCreditPack.price } : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT session types" }, { status: 500 });
  }
}
