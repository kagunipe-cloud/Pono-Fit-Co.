import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const ALLOWED = ["privacy", "terms", "gym_waiver"] as const;

/** GET — serve an uploaded document (PDF). Public. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!type || !ALLOWED.includes(type as (typeof ALLOWED)[number])) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dir = path.join(process.cwd(), "data", "documents");
  const filepath = path.join(dir, `${type}.pdf`);
  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const buf = fs.readFileSync(filepath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${type}.pdf"`,
    },
  });
}
