import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { OnboardingDocsClient } from "./OnboardingDocsClient";

const DOC_PATH = path.join(process.cwd(), "docs", "POST_MIGRATION_GLOFOX_STRIPE.md");

export default function AdminOnboardingDocsPage() {
  let markdown = "";
  let error: string | null = null;
  try {
    markdown = fs.readFileSync(DOC_PATH, "utf8");
  } catch {
    error = "Could not load onboarding document. Ensure docs/POST_MIGRATION_GLOFOX_STRIPE.md exists on the server.";
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-8 print:hidden">
        <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Onboarding docs</h1>
        <p className="text-stone-500 mt-1">
          Checklists and guidance for new gyms (Stripe migration, renewals, and go-live). Content ships with the app from{" "}
          <code className="text-sm font-mono bg-stone-100 px-1 rounded">docs/POST_MIGRATION_GLOFOX_STRIPE.md</code>.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/admin/import-onboarding" className="text-brand-600 hover:underline font-medium">
            Import onboarding CSV
          </Link>
          {" — "}
          paste filled rows (Stripe id, subscriptions, auto-renew) into the app.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-stone-200 bg-white p-5 shadow-sm print:hidden">
        <h2 className="text-lg font-semibold text-stone-800 mb-1">CSV templates</h2>
        <p className="text-sm text-stone-600 mb-3">
          Same files as in <code className="text-xs font-mono bg-stone-100 px-1 rounded">docs/</code> and <code className="text-xs font-mono bg-stone-100 px-1 rounded">public/</code>. Use after{" "}
          <Link href="/admin/import-members" className="text-brand-600 hover:underline">
            Import members (Glofox)
          </Link>
          , then fill and run <Link href="/admin/import-onboarding" className="text-brand-600 hover:underline">Import onboarding</Link>.
        </p>
        <ul className="text-sm text-stone-700 space-y-2">
          <li>
            <a href="/onboarding-import-template.csv" download className="text-brand-600 hover:underline font-medium">
              Minimal template
            </a>
            <span className="text-stone-500"> — email, auto_renew, stripe_customer_id, membership_plan_name, subscription_quantity, notes</span>
          </li>
          <li>
            <a href="/onboarding-import-full-template.csv" download className="text-brand-600 hover:underline font-medium">
              Full template
            </a>
            <span className="text-stone-500"> — product_id, subscription dates, optional price overrides</span>
          </li>
          <li>
            <a href="/onboarding-import-example.csv" download className="text-brand-600 hover:underline font-medium">
              Example row
            </a>
            <span className="text-stone-500"> — sample values; delete or replace before import</span>
          </li>
        </ul>
      </section>

      {error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : (
        <OnboardingDocsClient markdown={markdown} />
      )}
    </div>
  );
}
