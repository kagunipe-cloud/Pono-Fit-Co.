import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureRetailCategoriesTable, ensureRetailProductGroupsTable, ensureRetailProductsTable } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

type CategoryRow = { id: number; name: string; sort_order: number };

/** PATCH { name?, sort_order? } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  ensureRetailCategoriesTable(db);
  const existing = db.prepare("SELECT id FROM retail_categories WHERE id = ?").get(id) as { id: number } | undefined;
  if (!existing) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) {
      db.close();
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    updates.push("name = ?");
    vals.push(name);
  }
  if (body.sort_order != null) {
    const n = parseInt(String(body.sort_order), 10);
    if (!Number.isNaN(n)) {
      updates.push("sort_order = ?");
      vals.push(n);
    }
  }
  if (updates.length === 0) {
    db.close();
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  try {
    vals.push(id);
    db.prepare(`UPDATE retail_categories SET ${updates.join(", ")} WHERE id = ?`).run(...vals);
    const row = db.prepare("SELECT id, name, sort_order FROM retail_categories WHERE id = ?").get(id) as CategoryRow;
    db.close();
    return NextResponse.json(row);
  } catch (e) {
    db.close();
    const msg = e instanceof Error ? e.message : "";
    if (msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "A category with this name already exists" }, { status: 409 });
    }
    console.error("[retail-categories PATCH]", e);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const db = getDb();
  ensureRetailProductGroupsTable(db);
  const usedGroup = db.prepare("SELECT 1 FROM retail_product_groups WHERE category_id = ? LIMIT 1").get(id) as unknown;
  if (usedGroup) {
    db.close();
    return NextResponse.json({ error: "Remove this category from all product groups first" }, { status: 409 });
  }
  ensureRetailProductsTable(db);
  const usedProduct = db.prepare("SELECT 1 FROM retail_products WHERE category_id = ? LIMIT 1").get(id) as unknown;
  if (usedProduct) {
    db.close();
    return NextResponse.json({ error: "Remove this category from all products first" }, { status: 409 });
  }
  db.prepare("DELETE FROM retail_categories WHERE id = ?").run(id);
  db.close();
  return NextResponse.json({ ok: true });
}
