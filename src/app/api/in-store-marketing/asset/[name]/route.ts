import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const ASSET_DIR = path.join(process.cwd(), "data", "in-store-tv");

/** GET — Public slide asset from persistent storage (uploaded via admin). */
export async function GET(_request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const safe = path.basename(name ?? "");
  if (!safe || safe !== name) {
    return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  }

  const filepath = path.join(ASSET_DIR, safe);
  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(safe).toLowerCase();
  const type =
    ext === ".svg"
      ? "image/svg+xml"
      : ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";

  const body = fs.readFileSync(filepath);
  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
    },
  });
}
