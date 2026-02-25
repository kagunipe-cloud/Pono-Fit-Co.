"use client";

import { useState } from "react";
import Link from "next/link";

type Result = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors?: { row: number; email: string; message: string }[];
};

export default function AdminImportMembersPage() {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) {
      setError("Paste CSV or choose a file.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/import-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
        return;
      }
      setResult(data as Result);
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Import members (Glofox CSV)</h1>
        <p className="text-stone-500 mt-1">
          Paste or upload a Glofox members export. Rows are matched by <strong>email</strong> (case-insensitive).
          Existing members are updated; new emails create new members. Required: First Name, Last Name, Email. Role defaults to Member.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">CSV</label>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder='Paste CSV with header row: "Added","First Name","Last Name","Email",...'
            rows={12}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-stone-500">
            Or choose a file:{" "}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="inline-block text-sm text-stone-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-stone-200 file:bg-stone-50"
            />
          </p>
        </div>
        <button
          type="submit"
          disabled={loading || !csv.trim()}
          className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import"}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      {result && (
        <div className="mt-6 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h2 className="font-semibold text-stone-800 mb-2">Result</h2>
          <p className="text-sm text-stone-600">
            Created <strong>{result.created}</strong>, updated <strong>{result.updated}</strong>, skipped <strong>{result.skipped}</strong> (of {result.total} rows).
          </p>
          {result.errors && result.errors.length > 0 && (
            <ul className="mt-2 text-sm text-amber-700 list-disc list-inside">
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>Row {e.row} ({e.email}): {e.message}</li>
              ))}
              {result.errors.length > 10 && <li>… and {result.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
