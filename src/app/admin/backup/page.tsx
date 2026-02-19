"use client";

import { useState } from "react";
import Link from "next/link";

export default function AdminBackupPage() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleDownload() {
    const res = await fetch("/api/admin/backup");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Download failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "the-fox-says.db";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile) {
      setRestoreMessage({ type: "err", text: "Choose a file first." });
      return;
    }
    setRestoreMessage(null);
    setRestoreLoading(true);
    try {
      const formData = new FormData();
      formData.set("file", restoreFile);
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setRestoreMessage({ type: "err", text: data.error ?? "Upload failed." });
        return;
      }
      setRestoreMessage({ type: "ok", text: data.message ?? "Backup uploaded. Redeploy to apply." });
      setRestoreFile(null);
    } catch {
      setRestoreMessage({ type: "err", text: "Something went wrong." });
    } finally {
      setRestoreLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <header className="mb-8">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Backup &amp; Restore</h1>
        <p className="text-stone-500 mt-1">
          Download the database to back up, or upload a backup to replace it (e.g. copy data from dev to production).
        </p>
      </header>

      <div className="space-y-8">
        <section className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="font-semibold text-stone-800 mb-2">Download backup</h2>
          <p className="text-sm text-stone-500 mb-4">
            Saves a copy of the current database (members, products, schedule, etc.). Use this on your dev server to get a file you can restore on Railway.
          </p>
          <button
            type="button"
            onClick={handleDownload}
            className="px-4 py-2.5 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-700"
          >
            Download the-fox-says.db
          </button>
        </section>

        <section className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="font-semibold text-stone-800 mb-2">Restore from backup</h2>
          <p className="text-sm text-stone-500 mb-4">
            Upload a .db file to replace the database. The restore is applied on the next deploy or restart. After that, log in with an account from the restored data.
          </p>
          <form onSubmit={handleRestore} className="space-y-4">
            <input
              type="file"
              accept=".db,application/x-sqlite3"
              onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-stone-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-stone-100 file:text-stone-700"
            />
            <button
              type="submit"
              disabled={restoreLoading || !restoreFile}
              className="px-4 py-2.5 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 disabled:opacity-50"
            >
              {restoreLoading ? "Uploading…" : "Upload and prepare restore"}
            </button>
          </form>
          {restoreMessage && (
            <p className={`mt-4 text-sm ${restoreMessage.type === "ok" ? "text-green-700" : "text-red-600"}`}>
              {restoreMessage.text}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
