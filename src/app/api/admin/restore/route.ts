import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "../../../../lib/admin";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const dir = path.join(process.cwd(), "data");
const restorePendingPath = path.join(dir, "restore-pending.db");

/** POST: Upload a SQLite backup. Saved as restore-pending.db; redeploy or restart to apply (admin only). */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded. Send a form field named 'file' with your .db file." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "File is empty." }, { status: 400 });
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(restorePendingPath, buf);
    return NextResponse.json({
      success: true,
      message: "Backup saved. Redeploy this service (or restart the container) to apply the restore. After that, log in with an account from the restored database.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore upload failed" },
      { status: 500 }
    );
  }
}
