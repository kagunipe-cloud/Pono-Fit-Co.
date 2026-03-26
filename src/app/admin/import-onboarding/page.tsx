"use client";

import { useState } from "react";
import Link from "next/link";

type Result = {
  created: number;
  updated: number;
  skipped: number;
  subscriptionsUpserted: number;
  total: number;
  errors?: { row: number; email: string; message: string }[];
};

export default function AdminImportOnboardingPage() {
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
      const res = await fetch("/api/admin/import-onboarding", {
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
        <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Import onboarding (CSV)</h1>
        <p className="text-stone-500 mt-1">
          One row per member. Rows match on <strong>email</strong> (case-insensitive). Typical flow: run <strong>Import members (Glofox CSV)</strong> first, then paste a short
          onboarding CSV here with Stripe ids and plan names.
        </p>
        <p className="mt-3 text-sm text-stone-600">
          <a href="/onboarding-import-template.csv" className="text-brand-600 hover:underline" download>
            Minimal template
          </a>
          {" · "}
          <a href="/onboarding-import-full-template.csv" className="text-brand-600 hover:underline" download>
            Full template (product_id + dates)
          </a>
          {" · "}
          <a href="/onboarding-import-example.csv" className="text-brand-600 hover:underline" download>
            Example row
          </a>
          {" · "}
          <Link href="/admin/settings/onboarding" className="text-brand-600 hover:underline">
            Onboarding checklist
          </Link>
        </p>
      </header>

      <section className="mb-6 rounded-xl border border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-700 space-y-3">
        <div>
          <p className="font-medium text-stone-800">Recommended: minimal columns</p>
          <p className="mt-1">
            After <code className="text-xs bg-white px-1 rounded">email</code>, <code className="text-xs bg-white px-1 rounded">first_name</code>, <code className="text-xs bg-white px-1 rounded">last_name</code>,{" "}
            <code className="text-xs bg-white px-1 rounded">join_date</code>, <code className="text-xs bg-white px-1 rounded">phone</code>, and <code className="text-xs bg-white px-1 rounded">exp_next_payment_date</code> exist from the Glofox import, you only need{" "}
            <code className="text-xs bg-white px-1 rounded">email</code>, <code className="text-xs bg-white px-1 rounded">auto_renew</code>, <code className="text-xs bg-white px-1 rounded">stripe_customer_id</code>, and{" "}
            <code className="text-xs bg-white px-1 rounded">membership_plan_name</code> (exact match to the plan name in <strong>Membership plans</strong>). The app resolves{" "}
            <code className="text-xs bg-white px-1 rounded">product_id</code>, sets <code className="text-xs bg-white px-1 rounded">subscription_quantity</code> to 1 unless you add that column, derives subscription start from the plan length/unit and the member&apos;s next payment date, and uses the plan price unless you override with full-mode columns.
          </p>
        </div>
        <div>
          <p className="font-medium text-stone-800">Optional full mode</p>
          <p className="mt-1">
            Use <code className="text-xs bg-white px-1 rounded">membership_product_id</code> + <code className="text-xs bg-white px-1 rounded">subscription_expiry_date</code> (and optional start/quantity/price) instead of{" "}
            <code className="text-xs bg-white px-1 rounded">membership_plan_name</code>. Do not send both plan name and product id on the same row.
          </p>
        </div>
        <p className="text-stone-600">
          <code className="text-xs bg-white px-1 rounded">notes</code> is ignored. Dates accept <code className="text-xs">YYYY-MM-DD</code> or <code className="text-xs">M/D/YYYY</code>.
        </p>
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">CSV</label>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="Paste CSV with header row (see template download above)"
            rows={14}
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

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <p className="text-stone-800">
            Created {result.created}, updated {result.updated}, skipped empty {result.skipped}. Subscriptions created/updated: {result.subscriptionsUpserted}. Total rows:{" "}
            {result.total}.
          </p>
          {result.errors && result.errors.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-red-700 space-y-1">
              {result.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row} ({e.email}): {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
