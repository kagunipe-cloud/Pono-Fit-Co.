const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "the-fox-says.db");
const CSV_DIR = process.cwd();

// Trim keys so "Member_ID " becomes "Member_ID"
function trimRow(row) {
  const out = {};
  for (const k of Object.keys(row)) out[k.trim()] = row[k];
  return out;
}

const CONFIGS = [
  {
    file: "The Fox Says - Members.csv",
    table: "members",
    schema: `
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT, first_name TEXT, last_name TEXT, email TEXT,
        kisi_id TEXT, kisi_group_id TEXT, join_date TEXT, exp_next_payment_date TEXT, role TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `,
    columns: ["member_id", "first_name", "last_name", "email", "kisi_id", "kisi_group_id", "join_date", "exp_next_payment_date", "role"],
    map: (r) => [r["Member_ID"], r["First_Name"], r["Last_Name"], r["Email"], r["Kisi_ID"], r["Kisi_Group_ID"], r["Join_Date"], r["Exp/Next_Payment_Date"], r["Role"]],
  },
  {
    file: "The Fox Says - Money_Owed.csv",
    table: "money_owed",
    schema: `
      CREATE TABLE IF NOT EXISTS money_owed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT, product_id TEXT, amount_owed TEXT, days_remaining TEXT, health_check TEXT, member_name TEXT
      );
    `,
    columns: ["member_id", "product_id", "amount_owed", "days_remaining", "health_check", "member_name"],
    map: (r) => [r["Member_ID"], r["Product_ID"], r["Amount Owed"], r["Days_Remaining"], r["Health_Check"], r["Member_Name"]],
  },
  {
    file: "The Fox Says - Live_Dashboard.csv",
    table: "live_dashboard",
    schema: `
      CREATE TABLE IF NOT EXISTS live_dashboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT, status TEXT, expiry_date TEXT, days_remaining TEXT
      );
    `,
    columns: ["member_id", "status", "expiry_date", "days_remaining"],
    map: (r) => [r["Member_ID"], r["Status"], r["Expiry_Date"], r["Days_Remaining"]],
  },
  {
    file: "The Fox Says - PT_Bookings.csv",
    table: "pt_bookings",
    schema: `
      CREATE TABLE IF NOT EXISTS pt_bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pt_booking_id TEXT, product_id TEXT, member_id TEXT, checked_in TEXT, payment_status TEXT,
        booking_date TEXT, sales_id TEXT, price TEXT, quantity TEXT
      );
    `,
    columns: ["pt_booking_id", "product_id", "member_id", "checked_in", "payment_status", "booking_date", "sales_id", "price", "quantity"],
    map: (r) => [r["PT_Booking_ID"], r["Product_ID"], r["Member_ID"], r["Checked_In?"], r["Payment_Status"], r["Booking_Date"], r["Sales_ID"], r["Price"], r["Quantity"]],
  },
  {
    file: "The Fox Says - Class_Bookings.csv",
    table: "class_bookings",
    schema: `
      CREATE TABLE IF NOT EXISTS class_bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_booking_id TEXT, product_id TEXT, member_id TEXT, checked_in TEXT, payment_status TEXT,
        booking_date TEXT, sales_id TEXT, price TEXT, quantity TEXT
      );
    `,
    columns: ["class_booking_id", "product_id", "member_id", "checked_in", "payment_status", "booking_date", "sales_id", "price", "quantity"],
    map: (r) => [r["Class_Booking_ID"], r["Product_ID"], r["Member_ID"], r["Checked_In?"], r["Payment_Status"], r["Booking_Date"], r["Sales_ID"], r["Price"], r["Quantity"]],
  },
  {
    file: "The Fox Says - Subscriptions.csv",
    table: "subscriptions",
    schema: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id TEXT, member_id TEXT, product_id TEXT, status TEXT, start_date TEXT, expiry_date TEXT,
        days_remaining TEXT, kisi_id TEXT, health_check TEXT, price TEXT, sales_id TEXT, quantity TEXT
      );
    `,
    columns: ["subscription_id", "member_id", "product_id", "status", "start_date", "expiry_date", "days_remaining", "kisi_id", "health_check", "price", "sales_id", "quantity"],
    map: (r) => [r["Subscription_ID"], r["Member_ID"], r["Product_ID"], r["Status"], r["Start_Date"], r["Expiry_Date"], r["Days_Remaining"], r["Kisi_ID"], r["Health_Check"], r["Price"], r["Sales_ID"], r["Quantity"]],
  },
  {
    file: "The Fox Says - Shopping_Cart.csv",
    table: "shopping_cart",
    schema: `
      CREATE TABLE IF NOT EXISTS shopping_cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line_item_id TEXT, sales_id TEXT, product_id TEXT, category TEXT, price TEXT, quantity TEXT, member_id TEXT, email TEXT
      );
    `,
    columns: ["line_item_id", "sales_id", "product_id", "category", "price", "quantity", "member_id", "email"],
    map: (r) => [r["Line_Item_ID"], r["Sales_ID"], r["Product_ID"], r["Category"], r["Price"], r["Quantity"], r["Member_ID"], r["Email"]],
  },
  {
    file: "The Fox Says - Sales.csv",
    table: "sales",
    schema: `
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_id TEXT, date_time TEXT, member_id TEXT, stripe_link TEXT, grand_total TEXT, email TEXT, status TEXT, price TEXT
      );
    `,
    columns: ["sales_id", "date_time", "member_id", "stripe_link", "grand_total", "email", "status", "price"],
    map: (r) => [r["Sales_ID"], r["Date/Time"], r["Member_ID"], r["Stripe_Link"], r["Grand_Total"], r["Email"], r["Status"], r["Price"]],
  },
  {
    file: "The Fox Says - PT_Sessions.csv",
    table: "pt_sessions",
    schema: `
      CREATE TABLE IF NOT EXISTS pt_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT, session_name TEXT, session_duration TEXT, date_time TEXT, price TEXT,
        trainer TEXT, stripe_link TEXT, category TEXT, description TEXT
      );
    `,
    columns: ["product_id", "session_name", "session_duration", "date_time", "price", "trainer", "stripe_link", "category", "description"],
    map: (r) => [r["Product_ID"], r["Session_Name"], r["Session_Duration"], r["Date/Time"], r["Price"], r["Trainer"], r["Stripe_Link"], r["Category"], r["Description"]],
  },
  {
    file: "The Fox Says - Classes.csv",
    table: "classes",
    schema: `
      CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT, class_name TEXT, instructor TEXT, date TEXT, time TEXT, capacity TEXT, status TEXT,
        price TEXT, stripe_link TEXT, category TEXT, description TEXT
      );
    `,
    columns: ["product_id", "class_name", "instructor", "date", "time", "capacity", "status", "price", "stripe_link", "category", "description"],
    map: (r) => [r["Product_ID"], r["Class_Name"], r["Instructor"], r["Date"], r["Time"], r["Capacity"], r["Status"], r["Price"], r["Stripe_Link"], r["Category"], r["Description"]],
  },
  {
    file: "The Fox Says - Membership_Plans.csv",
    table: "membership_plans",
    schema: `
      CREATE TABLE IF NOT EXISTS membership_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT, plan_name TEXT, price TEXT, length TEXT, unit TEXT, access_level TEXT, stripe_link TEXT, category TEXT, description TEXT
      );
    `,
    columns: ["product_id", "plan_name", "price", "length", "unit", "access_level", "stripe_link", "category", "description"],
    map: (r) => [r["Product_ID"], r["Plan_Name"], r["Price"], r["Length"], r["Unit"], r["Access_Level"], r["Stripe_Link"], r["Category"], r["Description"]],
  },
];

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

const onlyTable = process.env.TABLE ? process.env.TABLE.trim() : null;
const configs = onlyTable
  ? CONFIGS.filter((c) => c.table === onlyTable)
  : CONFIGS;

if (onlyTable && configs.length === 0) {
  console.error("Unknown TABLE:", onlyTable);
  process.exit(1);
}

for (const cfg of configs) {
  const csvPath = path.join(CSV_DIR, cfg.file);
  if (!fs.existsSync(csvPath)) {
    console.warn("Skipping (file not found):", cfg.file);
    continue;
  }

  db.exec(cfg.schema);
  db.exec(`DELETE FROM ${cfg.table}`);

  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true })
    .map(trimRow)
    .filter((row) => {
      const vals = cfg.map(row);
      return vals.some((v) => v != null && String(v).trim() !== "");
    });

  const placeholders = cfg.columns.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO ${cfg.table} (${cfg.columns.join(", ")}) VALUES (${placeholders})`);

  const run = db.transaction(() => {
    for (const row of rows) {
      const vals = cfg.map(row).map((v) => (v != null && String(v).trim() !== "" ? String(v).trim() : null));
      insert.run(...vals);
    }
  });

  run();
  console.log(`${cfg.table}: imported ${rows.length} rows from ${cfg.file}`);
}

db.close();
console.log("Done. Database:", DB_PATH);
