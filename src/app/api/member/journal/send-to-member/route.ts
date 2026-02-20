import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";
import { ensureJournalTables } from "@/lib/journal";

export const dynamic = "force-dynamic";

/**
 * POST { recipient_email: string, date: string (YYYY-MM-DD) }.
 * Copies the sender's journal day (all meals and entries) to the recipient's journal for the same date.
 * Member-only; cannot send to yourself.
 */
export async function POST(request: NextRequest) {
  try {
    const senderId = await getMemberIdFromSession();
    if (!senderId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const recipientEmail = (body.recipient_email ?? "").toString().trim().toLowerCase();
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;

    if (!recipientEmail) {
      return NextResponse.json({ error: "recipient_email is required" }, { status: 400 });
    }
    if (!date) {
      return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
    }

    const db = getDb();
    ensureFoodsTable(db);
    ensureJournalTables(db);

    const recipient = db
      .prepare("SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1")
      .get(recipientEmail) as { member_id: string } | undefined;
    if (!recipient) {
      db.close();
      return NextResponse.json({ error: "No member found with that email" }, { status: 404 });
    }
    if (recipient.member_id === senderId) {
      db.close();
      return NextResponse.json({ error: "You cannot send a day to yourself" }, { status: 400 });
    }

    const senderDay = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(senderId, date) as { id: number } | undefined;
    if (!senderDay) {
      db.close();
      return NextResponse.json({ error: "You don't have a journal entry for that date" }, { status: 404 });
    }

    const meals = db.prepare("SELECT id, name, sort_order FROM journal_meals WHERE journal_day_id = ? ORDER BY sort_order, id").all(senderDay.id) as { id: number; name: string; sort_order: number }[];
    if (meals.length === 0) {
      db.close();
      return NextResponse.json({ error: "This day has no meals to share" }, { status: 400 });
    }

    const entryCols = db.prepare("PRAGMA table_info(journal_meal_entries)").all() as { name: string }[];
    const hasDisplayUnits = entryCols.some((c) => c.name === "quantity") && entryCols.some((c) => c.name === "measurement");
    const entrySelect = hasDisplayUnits
      ? "SELECT food_id, amount, sort_order, quantity, measurement FROM journal_meal_entries"
      : "SELECT food_id, amount, sort_order FROM journal_meal_entries";

    let recipientDay = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(recipient.member_id, date) as { id: number } | undefined;
    if (!recipientDay) {
      db.prepare("INSERT INTO journal_days (member_id, date) VALUES (?, ?)").run(recipient.member_id, date);
      recipientDay = db.prepare("SELECT id FROM journal_days WHERE member_id = ? AND date = ?").get(recipient.member_id, date) as { id: number };
    }

    const insertMeal = db.prepare("INSERT INTO journal_meals (journal_day_id, name, sort_order) VALUES (?, ?, ?)");
    const getEntries = db.prepare(`${entrySelect} WHERE journal_meal_id = ? ORDER BY sort_order, id`);
    const insertEntryBase = db.prepare("INSERT INTO journal_meal_entries (journal_meal_id, food_id, amount, sort_order) VALUES (?, ?, ?, ?)");
    const insertEntryWithDisplay = hasDisplayUnits
      ? db.prepare("INSERT INTO journal_meal_entries (journal_meal_id, food_id, amount, sort_order, quantity, measurement) VALUES (?, ?, ?, ?, ?, ?)")
      : null;

    for (const meal of meals) {
      const mealResult = insertMeal.run(recipientDay.id, meal.name, meal.sort_order);
      const newMealId = mealResult.lastInsertRowid as number;
      const entries = getEntries.all(meal.id) as { food_id: number; amount: number; sort_order: number; quantity?: number | null; measurement?: string | null }[];
      for (const e of entries) {
        if (insertEntryWithDisplay) {
          insertEntryWithDisplay.run(newMealId, e.food_id, e.amount, e.sort_order, e.quantity ?? null, e.measurement ?? null);
        } else {
          insertEntryBase.run(newMealId, e.food_id, e.amount, e.sort_order);
        }
      }
    }

    db.close();
    return NextResponse.json({
      ok: true,
      message: `Day shared with ${recipientEmail}. They'll see it on their Macros page for ${date}.`,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to share day" }, { status: 500 });
  }
}
