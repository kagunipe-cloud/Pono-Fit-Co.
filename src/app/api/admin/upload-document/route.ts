import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["privacy", "terms", "gym_waiver"] as const;
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/** POST — admin: upload a document (PDF). Body: multipart/form-data with `file` and `type` (privacy|terms|gym_waiver). */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await request.formData();
    const type = formData.get("type")?.toString()?.trim();
    const file = formData.get("file");

    if (!type || !ALLOWED_TYPES.includes(type as (typeof ALLOWED_TYPES)[number])) {
      return NextResponse.json({ error: "Invalid type. Use privacy, terms, or gym_waiver." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase() || ".pdf";
    if (ext !== ".pdf") {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 400 });
    }

    const dir = path.join(process.cwd(), "data", "documents");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filename = `${type}${ext}`;
    const filepath = path.join(dir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    const db = getDb();
    const key = `document_${type}_file`;
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, filename);
    db.close();

    return NextResponse.json({ ok: true, filename });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
