import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const SLUG_TO_TABLE: Record<string, string> = {
  members: "members",
  "pt-bookings": "pt_bookings",
  "class-bookings": "class_bookings",
  subscriptions: "subscriptions",
  transactions: "sales",
  sales: "sales",
  "pt-sessions": "pt_sessions",
  classes: "classes",
  "membership-plans": "membership_plans",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table: slug } = await params;
  const tableName = SLUG_TO_TABLE[slug];
  if (!tableName) {
    return NextResponse.json({ error: "Unknown table" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();

  try {
    const db = getDb();
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string; type: string }[];
    const columns = tableInfo.map((c) => c.name).filter((c) => c !== "id");
    const searchColumns = tableInfo.filter((c) => c.name !== "id" && c.type === "TEXT").map((c) => c.name);

    let rows: Record<string, unknown>[];
    if (q && searchColumns.length > 0) {
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      const placeholders = searchColumns.map(() => pattern);
      const stmt = db.prepare(
        `SELECT * FROM ${tableName} WHERE ${searchColumns.map((c) => `"${c}" LIKE ?`).join(" OR ")} ORDER BY id ASC`
      );
      rows = stmt.all(...placeholders) as Record<string, unknown>[];
    } else {
      const stmt = db.prepare(`SELECT * FROM ${tableName} ORDER BY id ASC`);
      rows = stmt.all() as Record<string, unknown>[];
    }

    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}
