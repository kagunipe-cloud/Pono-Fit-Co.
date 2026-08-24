import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  loadInStoreMarketingRotationAdmin,
  readStoredMarketingRotation,
  saveMarketingRotation,
  type StoredMarketingSlide,
} from "@/lib/in-store-marketing";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

/** POST — Upload a landscape slide and add it to the TV rotation. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim() || "Marketing slide";
    const description = String(formData.get("description") ?? "").trim();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase() || ".png";
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: "Use PNG, JPG, WEBP, or SVG." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 8 MB)." }, { status: 400 });
    }

    const dir = path.join(process.cwd(), "data", "in-store-tv");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const id = `upload-${randomUUID().slice(0, 8)}`;
    const filename = `${id}${ext}`;
    const filepath = path.join(dir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    const src = `/api/in-store-marketing/asset/${filename}`;
    const db = getDb();
    const current = readStoredMarketingRotation(db);
    current.push({ id, title, description, src, enabled: true });
    saveMarketingRotation(db, current);
    db.close();

    return NextResponse.json({ ok: true, id, title, src });
  } catch (err) {
    console.error("[in-store-marketing/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
