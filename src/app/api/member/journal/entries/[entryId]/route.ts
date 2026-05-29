import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";
import { quantityAndMeasurementToAmount } from "@/lib/food-units";

export const dynamic = "force-dynamic";

/** PATCH — update entry portion. Body: { quantity, measurement } or legacy { amount }. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const entryId = parseInt((await params).entryId, 10);
    if (Number.isNaN(entryId)) return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const quantityRaw = body.quantity;
    const measurementRaw = typeof body.measurement === "string" ? body.measurement.trim() : "";
    const hasDisplayInput =
      quantityRaw != null &&
      quantityRaw !== "" &&
      measurementRaw.length > 0 &&
      !Number.isNaN(parseFloat(String(quantityRaw)));

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);
    const cols = db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[];
    const hasDisplayUnits = cols.some((c) => c.name === "quantity") && cols.some((c) => c.name === "measurement");

    const entry = db
      .prepare(
        `SELECT e.id, e.amount, e.quantity, e.measurement,
                f.serving_size, f.serving_size_unit
         FROM journal_meal_entries e
         JOIN journal_meals jm ON jm.id = e.journal_meal_id
         JOIN journal_days jd ON jd.id = jm.journal_day_id
         JOIN foods f ON f.id = e.food_id
         WHERE e.id = ? AND jd.member_id = ?`
      )
      .get(entryId, memberId) as
      | {
          id: number;
          amount: number;
          quantity?: number | null;
          measurement?: string | null;
          serving_size: number | null;
          serving_size_unit: string | null;
        }
      | undefined;

    if (!entry) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (hasDisplayInput) {
      const quantity = parseFloat(String(quantityRaw));
      if (Number.isNaN(quantity) || quantity <= 0) {
        db.close();
        return NextResponse.json({ error: "Valid quantity required" }, { status: 400 });
      }
      const computed = quantityAndMeasurementToAmount(
        quantity,
        measurementRaw,
        entry.serving_size,
        entry.serving_size_unit
      );
      if (computed == null || computed <= 0) {
        db.close();
        return NextResponse.json({ error: "Could not convert quantity to a serving amount" }, { status: 400 });
      }
      if (hasDisplayUnits) {
        db.prepare("UPDATE journal_meal_entries SET amount = ?, quantity = ?, measurement = ? WHERE id = ?").run(
          computed,
          quantity,
          measurementRaw,
          entryId
        );
      } else {
        db.prepare("UPDATE journal_meal_entries SET amount = ? WHERE id = ?").run(computed, entryId);
      }
      db.close();
      return NextResponse.json({ id: entryId, amount: computed, quantity, measurement: measurementRaw });
    }

    const amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount ?? 1));
    if (Number.isNaN(amount) || amount <= 0) {
      db.close();
      return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
    }
    if (hasDisplayUnits) {
      db.prepare("UPDATE journal_meal_entries SET amount = ?, quantity = NULL, measurement = NULL WHERE id = ?").run(
        amount,
        entryId
      );
    } else {
      db.prepare("UPDATE journal_meal_entries SET amount = ? WHERE id = ?").run(amount, entryId);
    }
    db.close();
    return NextResponse.json({ id: entryId, amount });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }
}

/** DELETE — remove entry. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const entryId = parseInt((await params).entryId, 10);
    if (Number.isNaN(entryId)) return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });

    const db = getDb();
    ensureJournalTables(db);
    const entry = db.prepare(
      `SELECT e.id FROM journal_meal_entries e
       JOIN journal_meals jm ON jm.id = e.journal_meal_id
       JOIN journal_days jd ON jd.id = jm.journal_day_id
       WHERE e.id = ? AND jd.member_id = ?`
    ).get(entryId, memberId);
    if (!entry) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    db.prepare("DELETE FROM journal_meal_entries WHERE id = ?").run(entryId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }
}
