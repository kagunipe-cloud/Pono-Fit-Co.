import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

/** Returns distinct class types plus all class packs for "Buy now & schedule later". */
export async function GET() {
  try {
    const db = getDb();
    ensureRecurringClassesTables(db);
    const types = db
      .prepare(
        `SELECT c.class_name, c.instructor, c.price, c.description, c.image_url
         FROM classes c
         INNER JOIN (
           SELECT class_name, COALESCE(instructor, '') AS inst, MIN(id) AS min_id
           FROM classes
           GROUP BY class_name, COALESCE(instructor, '')
         ) sub ON c.class_name = sub.class_name AND COALESCE(c.instructor, '') = sub.inst AND c.id = sub.min_id
         ORDER BY c.class_name ASC, c.instructor ASC`
      )
      .all() as { class_name: string; instructor: string | null; price: string | null; description: string | null; image_url: string | null }[];
    const classPacks = db
      .prepare("SELECT id, name, price, credits FROM class_pack_products ORDER BY credits ASC")
      .all() as { id: number; name: string; price: string; credits: number }[];
    const singleCreditPack = classPacks.find((p) => p.credits === 1)
      ? { id: classPacks.find((p) => p.credits === 1)!.id, price: classPacks.find((p) => p.credits === 1)!.price }
      : null;
    db.close();
    return NextResponse.json({
      types,
      classPacks,
      singleCreditPack,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class types" }, { status: 500 });
  }
}
