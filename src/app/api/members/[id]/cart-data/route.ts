import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersStripeColumn } from "../../../../../lib/db";
import { formatDateForDisplay } from "../../../../../lib/app-timezone";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../../lib/session";
import { hasBillableStripeCustomer } from "../../../../../lib/stripe-customer";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { ensureDiscountsTable } from "../../../../../lib/discounts";

export const dynamic = "force-dynamic";

function ensureCartTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (cart_id) REFERENCES cart(id)
    );
  `);
  try {
    db.exec("ALTER TABLE cart ADD COLUMN promo_code TEXT");
  } catch {
    /* already exists */
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const isPurelyNumeric = /^\d+$/.test(id);
  try {
    const db = getDb();
    ensureMembersStripeColumn(db);

    // Prefer member_id (URL from members list uses member_id); fallback to id when numeric
    let member = db.prepare("SELECT id, member_id, first_name, last_name, stripe_customer_id FROM members WHERE member_id = ?").get(id) as
      | { member_id: string; first_name: string; last_name: string; stripe_customer_id: string | null }
      | undefined;
    if (!member && isPurelyNumeric) {
      member = db.prepare("SELECT id, member_id, first_name, last_name, stripe_customer_id FROM members WHERE id = ?").get(parseInt(id, 10)) as
        | { member_id: string; first_name: string; last_name: string; stripe_customer_id: string | null }
        | undefined;
    }
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    ensureCartTables(db);
    ensureRecurringClassesTables(db);
    let cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member.member_id) as { id: number; promo_code?: string | null } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member.member_id);
      cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member.member_id) as { id: number; promo_code?: string | null };
    }

    const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as { id: number; product_type: string; product_id: number; quantity: number }[];
    const items: {
      id: number;
      product_type: string;
      product_id: number;
      quantity: number;
      name: string;
      price: string;
      plan_unit?: string;
    }[] = [];
    for (const it of rawItems) {
      let name = "—";
      let price = "—";
      let plan_unit: string | undefined;
      if (it.product_type === "membership_plan") {
        const row = db.prepare("SELECT plan_name, price, unit FROM membership_plans WHERE id = ?").get(it.product_id) as
          | { plan_name: string; price: string; unit: string }
          | undefined;
        if (row) {
          name = row.plan_name ?? "—";
          price = row.price ?? "—";
          plan_unit = row.unit ?? undefined;
        }
      } else if (it.product_type === "pt_session") {
        const row = db.prepare("SELECT session_name, price FROM pt_sessions WHERE id = ?").get(it.product_id) as { session_name: string; price: string } | undefined;
        if (row) { name = row.session_name ?? "—"; price = row.price ?? "—"; }
      } else if (it.product_type === "class") {
        const row = db.prepare("SELECT class_name, price FROM classes WHERE id = ?").get(it.product_id) as { class_name: string; price: string } | undefined;
        if (row) { name = row.class_name ?? "—"; price = row.price ?? "—"; }
      } else if (it.product_type === "class_pack") {
        const row = db.prepare("SELECT name, price, credits FROM class_pack_products WHERE id = ?").get(it.product_id) as { name: string; price: string; credits: number } | undefined;
        if (row) { name = `${row.name ?? "—"} (${row.credits} credits)`; price = row.price ?? "—"; }
      } else if (it.product_type === "class_occurrence") {
        const row = db.prepare(`
          SELECT COALESCE(c.class_name, r.name) AS name, COALESCE(c.price, '0') AS price, o.occurrence_date, o.occurrence_time
          FROM class_occurrences o
          LEFT JOIN classes c ON c.id = o.class_id
          LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
          WHERE o.id = ?
        `).get(it.product_id) as { name: string; price: string; occurrence_date: string; occurrence_time: string } | undefined;
        if (row) {
          const tz = getAppTimezone(db);
          name = `${row.name ?? "Class"} — ${formatDateForDisplay(row.occurrence_date, tz)} ${row.occurrence_time}`;
          price = row.price ?? "—";
        }
      } else if (it.product_type === "pt_pack") {
        ensurePTSlotTables(db);
        const row = db.prepare("SELECT name, price, credits, duration_minutes FROM pt_pack_products WHERE id = ?").get(it.product_id) as { name: string; price: string; credits: number; duration_minutes: number } | undefined;
        if (row) { name = `${row.name ?? "—"} (${row.credits}×${row.duration_minutes} min)`; price = row.price ?? "—"; }
      }
      items.push({ ...it, name, price, ...(plan_unit != null ? { plan_unit } : {}) });
    }

    const plans = db.prepare("SELECT id, plan_name, price, unit FROM membership_plans ORDER BY id").all() as {
      id: number;
      plan_name: string;
      price: string;
      unit: string;
    }[];
    const sessions = db.prepare("SELECT id, session_name, price FROM pt_sessions ORDER BY id").all() as { id: number; session_name: string; price: string }[];
    const classes = db.prepare("SELECT id, class_name, price FROM classes ORDER BY id").all() as { id: number; class_name: string; price: string }[];
    const classPacks = db.prepare("SELECT id, name, price, credits FROM class_pack_products ORDER BY credits ASC").all() as { id: number; name: string; price: string; credits: number }[];
    ensurePTSlotTables(db);
    const ptPackProducts = db.prepare("SELECT id, name, price, credits, duration_minutes FROM pt_pack_products ORDER BY duration_minutes, credits").all() as { id: number; name: string; price: string; credits: number; duration_minutes: number }[];

    ensureDiscountsTable(db);
    let discount: { percent_off: number; code: string; description: string | null } | null = null;
    const promoCode = (cart as { promo_code?: string | null }).promo_code?.trim();
    if (promoCode) {
      const d = db.prepare("SELECT code, percent_off, description FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as
        | { code: string; percent_off: number; description: string | null }
        | undefined;
      if (d) discount = { code: d.code, percent_off: d.percent_off, description: d.description };
    }

    const class_credits = getMemberCreditBalance(db, member.member_id);
    const sessionMemberId = await getMemberIdFromSession();
    const is_own_cart = !!sessionMemberId && sessionMemberId === member.member_id;
    db.close();

    const memberName = [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member";
    const has_saved_card = hasBillableStripeCustomer(
      (member as { stripe_customer_id?: string | null }).stripe_customer_id
    );
    return NextResponse.json({
      memberId: member.member_id,
      memberName,
      has_saved_card,
      class_credits,
      is_own_cart,
      items,
      plans,
      sessions,
      classes,
      classPacks,
      ptPackProducts,
      promo_code: promoCode || null,
      discount: discount ? { code: discount.code, percent_off: discount.percent_off, description: discount.description } : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load cart data" }, { status: 500 });
  }
}
