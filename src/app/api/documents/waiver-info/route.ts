import { NextResponse } from "next/server";
import { getDocumentSettings } from "@/lib/documents";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** GET — returns gym waiver display info: url for PDF or html for inline. Public. */
export async function GET() {
  const { html, hasFile } = getDocumentSettings("gym_waiver");
  if (hasFile) {
    return NextResponse.json({ url: "/api/documents/gym_waiver", html: null });
  }
  if (html) {
    return NextResponse.json({ url: null, html });
  }
  // Fallback to default waiver.pdf in public
  const defaultPath = path.join(process.cwd(), "public", "waiver.pdf");
  if (fs.existsSync(defaultPath)) {
    return NextResponse.json({ url: "/waiver.pdf", html: null });
  }
  return NextResponse.json({ url: null, html: null });
}
