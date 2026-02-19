import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "../../../../lib/admin";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const dbPath = path.join(process.cwd(), "data", "the-fox-says.db");

/** GET: Download the SQLite database (admin only). Use to backup dev data and restore on Railway. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: "No database file" }, { status: 404 });
  }
  const buffer = fs.readFileSync(dbPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Content-Disposition": 'attachment; filename="the-fox-says.db"',
    },
  });
}
