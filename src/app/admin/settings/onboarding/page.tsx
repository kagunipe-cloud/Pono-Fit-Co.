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
      </header>

      {error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : (
        <OnboardingDocsClient markdown={markdown} />
      )}
    </div>
  );
}
