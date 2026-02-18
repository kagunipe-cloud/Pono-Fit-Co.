import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { SECTIONS } from "@/lib/sections";

export default function Home() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">{BRAND.name}</h1>
      <p className="text-stone-600 mb-6">Gym management dashboard</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.slug}
            href={`/${s.slug}`}
            className="block p-4 rounded-lg border border-stone-200 bg-white hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
          >
            <span className="font-medium text-stone-800">{s.title}</span>
            <p className="text-sm text-stone-500 mt-1">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
