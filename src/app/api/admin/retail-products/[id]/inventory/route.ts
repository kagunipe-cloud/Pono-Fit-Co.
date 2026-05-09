import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  ensureRetailProductsTable,
  ensureRetailInventoryLedgerTable,
  recordRetailInventoryMovement,
  type RetailInventoryReason,
} from "@/lib/retail-products";

export const dynamic = "force-dynamic";

const REASONS: RetailInventoryReason[] = ["receive", "shrink", "adjustment", "count"];

function parseDelta(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n === 0) return null;
  return n;
}

/**
 * POST { delta: number, reason: receive|shrink|adjustment|count, note?: string }
 * Positive delta adds stock (receive); negative removes (shrink) without a sale.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const delta = parseDelta(body.delta);
  const reason = String(body.reason ?? "").trim() as RetailInventoryReason;
  if (delta == null) {
    return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 });
  }
  if (!REASONS.includes(reason)) {
    return NextResponse.json({ error: "reason must be receive, shrink, adjustment, or count" }, { status: 400 });
  }
  const note = body.note != null ? String(body.note).trim() || null : null;

  const db = getDb();
  ensureRetailProductsTable(db);
  ensureRetailInventoryLedgerTable(db);
  const p = db.prepare("SELECT id, name, stock_quantity FROM retail_products WHERE id = ?").get(id) as
    | { id: number; name: string; stock_quantity: number }
    | undefined;
  if (!p) {
    db.close();
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  const have = Math.max(0, Math.floor(Number(p.stock_quantity) || 0));
  const next = have + delta;
  if (next < 0) {
    db.close();
    return NextResponse.json(
      { error: `Cannot remove ${Math.abs(delta)} — only ${have} on hand for ${p.name}.` },
      { status: 409 }
    );
  }
  db.prepare("UPDATE retail_products SET stock_quantity = ? WHERE id = ?").run(next, id);
  recordRetailInventoryMovement(db, {
    retail_product_id: id,
    delta,
    reason,
    note,
    created_by: adminId,
  });
  const row = db.prepare("SELECT id, sku, name, stock_quantity, unit_cost, price FROM retail_products WHERE id = ?").get(id) as {
    id: number;
    sku: string;
    name: string;
    stock_quantity: number;
    unit_cost: string | null;
    price: string;
  };
  db.close();
  return NextResponse.json(row);
}
