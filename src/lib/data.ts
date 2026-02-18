import { getDb } from "./db";

const SLUG_TO_TABLE: Record<string, string> = {
  members: "members",
  "money-owed": "money_owed",
  "live-dashboard": "live_dashboard",
  "pt-bookings": "pt_bookings",
  "class-bookings": "class_bookings",
  subscriptions: "subscriptions",
  "shopping-cart": "shopping_cart",
  sales: "sales",
  "pt-sessions": "pt_sessions",
  classes: "classes",
  "membership-plans": "membership_plans",
};

export function getTableData(slug: string, searchQuery?: string): Record<string, unknown>[] {
  const tableName = SLUG_TO_TABLE[slug];
  if (!tableName) return [];

  const db = getDb();
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string; type: string }[];
    const searchColumns = tableInfo.filter((c) => c.name !== "id" && c.type === "TEXT").map((c) => c.name);
    const q = (searchQuery ?? "").trim();

    let rows: Record<string, unknown>[];
    if (q && searchColumns.length > 0) {
      const pattern = `%${q}%`;
      const stmt = db.prepare(
        `SELECT * FROM ${tableName} WHERE ${searchColumns.map((c) => `"${c}" LIKE ?`).join(" OR ")} ORDER BY id ASC`
      );
      rows = stmt.all(...searchColumns.map(() => pattern)) as Record<string, unknown>[];
    } else {
      const stmt = db.prepare(`SELECT * FROM ${tableName} ORDER BY id ASC`);
      rows = stmt.all() as Record<string, unknown>[];
    }
    return rows;
  } catch {
    return [];
  } finally {
    db.close();
  }
}
