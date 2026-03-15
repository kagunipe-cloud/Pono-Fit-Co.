import { getDb } from "@/lib/db";
import fs from "fs";
import path from "path";

export type DocumentType = "privacy" | "terms" | "gym_waiver";

export function getDocumentSettings(type: DocumentType): { html: string | null; hasFile: boolean } {
  const db = getDb();
  try {
    const htmlRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`document_${type}_html`) as { value: string } | undefined;
    const fileRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`document_${type}_file`) as { value: string } | undefined;
    const html = htmlRow?.value?.trim() || null;
    const filename = fileRow?.value?.trim() || null;
    const filepath = filename ? path.join(process.cwd(), "data", "documents", filename) : null;
    const hasFile = !!(filepath && fs.existsSync(filepath));
    return { html, hasFile };
  } finally {
    db.close();
  }
}
