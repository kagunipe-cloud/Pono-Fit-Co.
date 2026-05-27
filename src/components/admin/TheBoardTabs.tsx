"use client";

import Link from "next/link";

export type TheBoardTab = "goals" | "records";

export function TheBoardTabs({ active }: { active: TheBoardTab }) {
  const tabs: { id: TheBoardTab; label: string; href: string }[] = [
    { id: "goals", label: "Weekly Goals", href: "/admin/the-board?tab=goals" },
    { id: "records", label: "Gym Records", href: "/admin/the-board?tab=records" },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            active === tab.id
              ? "bg-stone-800 text-[#9ef6b2] shadow-sm"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
