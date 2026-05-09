import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureRetailCategoriesTable } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  ensureRetailCategoriesTable(db);
  const categories = db
    .prepare(`SELECT id, name, sort_order FROM retail_categories ORDER BY sort_order ASC, name COLLATE NOCASE`)
    .all() as { id: number; name: string; sort_order: number }[];
  db.close();
  return NextResponse.json({ categories });
}

/** POST { name, sort_order? } */
export async function POST(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  let sort_order = 0;
  if (body.sort_order != null && String(body.sort_order).trim() !== "") {
    const n = parseInt(String(body.sort_order), 10);
    if (!Number.isNaN(n)) sort_order = n;
  }
  const db = getDb();
  ensureRetailCategoriesTable(db);
  try {
    const r = db.prepare("INSERT INTO retail_categories (name, sort_order) VALUES (?, ?)").run(name, sort_order);
    const id = Number(r.lastInsertRowid);
    const row = db.prepare("SELECT id, name, sort_order FROM retail_categories WHERE id = ?").get(id) as {
      id: number;
      name: string;
      sort_order: number;
    };
    db.close();
    return NextResponse.json(row);
  } catch (e) {
    db.close();
    const msg = e instanceof Error ? e.message : "";
    if (msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "A category with this name already exists" }, { status: 409 });
    }
    console.error("[retail-categories POST]", e);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
