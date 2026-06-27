import Link from "next/link";
import { REPORT_EXTRA_LINKS, getReportSubSections } from "@/lib/sections";

const REPORT_DESCRIPTIONS: Record<string, string> = {
  sales: "Revenue by date range and category, with drill-down sales details.",
  transactions: "Purchase history, payment status, and refund workflows.",
  "money-owed": "Declined, unpaid, or uncollected recurring payment follow-up.",
  subscriptions: "Active and cancelled subscriptions with renewal and expiry details.",
  "/members-expiry": "Memberships ending soon or recently expired for outreach.",
  "/admin/reports/member-unlocks": "Door unlock history by member and date range.",
  "/admin/reports/insurance": "Billable insurance visit-day counts by program.",
  "/admin/reports/workout-volume": "Finished workout volume by member and date range.",
  "/admin/reports/auto-renew-changes": "When members turn auto-renew on or off, by date range.",
  "/admin/reports/membership-flow":
    "New members, plan changes, renewals, and auto-renew toggles by membership type.",
  "/admin/usage": "Check-ins and usage activity from unlocks and manual entries.",
};

const EXTRA_REPORTS = [
  ...REPORT_EXTRA_LINKS,
  { href: "/admin/usage", title: "Check-Ins" },
] as const;

export default function ReportsPage() {
  const sectionReports = getReportSubSections().map(({ slug, title }) => ({
    href: `/${slug}`,
    title,
    description: REPORT_DESCRIPTIONS[slug],
  }));
  const extraReports = EXTRA_REPORTS.map(({ href, title }) => ({
    href,
    title,
    description: REPORT_DESCRIPTIONS[href],
  }));
  const reports = [...sectionReports, ...extraReports];

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Reports</h1>
      <p className="text-stone-600 mb-6">
        Choose the report you want to view for sales, member follow-up, subscriptions, access, and gym usage.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/50"
          >
            <span className="font-semibold text-stone-800">{report.title}</span>
            <p className="mt-1 text-sm text-stone-500">{report.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
