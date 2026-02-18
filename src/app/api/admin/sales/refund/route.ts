import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

/** POST { sales_id: string } — Admin only. Sets sale status to Refunded and cancels any subscriptions linked to this sale. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const sales_id = (body.sales_id ?? "").trim();
    if (!sales_id) {
      return NextResponse.json({ error: "sales_id required" }, { status: 400 });
    }
    const db = getDb();
    const sale = db.prepare("SELECT sales_id, member_id, status FROM sales WHERE sales_id = ?").get(sales_id) as { sales_id: string; member_id: string; status: string } | undefined;
    if (!sale) {
      db.close();
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }
    if (sale.status === "Refunded") {
      db.close();
      return NextResponse.json({ error: "Sale is already refunded" }, { status: 400 });
    }
    db.prepare("UPDATE sales SET status = ? WHERE sales_id = ?").run("Refunded", sales_id);
    db.prepare("UPDATE subscriptions SET status = ? WHERE sales_id = ?").run("Cancelled", sales_id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to refund sale" }, { status: 500 });
  }
}
