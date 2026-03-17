import Link from "next/link";
import { BRAND } from "@/lib/branding";
import AdminOccupancyWidget from "@/components/AdminOccupancyWidget";

const HOME_CARDS = [
  { href: "/members", title: "Members", description: "Member directory and management" },
  { href: "/trainer/my-clients", title: "Clients", description: "PT clients by trainer" },
  { href: "/admin/trainers", title: "Trainers", description: "Trainer roster and management" },
  { href: "/pt-bookings", title: "Bookings", description: "PT and class bookings" },
  { href: "/master-schedule", title: "Master Schedule", description: "Classes, PT sessions, and availability" },
  { href: "/membership-plans", title: "Services", description: "Plans, classes, PT sessions, packs, rec leagues" },
  { href: "/sales", title: "Reports", description: "Sales, transactions, money owed, subscriptions" },
  { href: "/admin/analytics", title: "Analytics", description: "Usage and performance insights" },
  { href: "/admin/leads", title: "Leads", description: "Prospects and inquiries" },
] as const;

export default function Home() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">{BRAND.name}</h1>
      <p className="text-stone-600 mb-6">Gym management dashboard</p>
      <AdminOccupancyWidget />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {HOME_CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block p-4 rounded-lg border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
          >
            <span className="font-medium text-stone-800">{c.title}</span>
            <p className="text-sm text-stone-500 mt-1">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
