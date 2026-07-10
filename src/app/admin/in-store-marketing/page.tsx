import Image from "next/image";
import Link from "next/link";
import { IN_STORE_MARKETING_SLIDES } from "@/lib/in-store-marketing";

export const metadata = {
  title: "In-Store Marketing | Pono Fit Co.",
};

export default function InStoreMarketingAdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">In-Store Marketing</h1>
          <p className="mt-1 text-sm text-stone-600">
            Landscape slideshow for the lobby TV. Add future display screens by adding another slide asset.
          </p>
        </div>
        <Link
          href="/admin/in-store-marketing/tv"
          target="_blank"
          className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-[#9ef6b2] hover:bg-stone-800"
        >
          Open TV Display ↗
        </Link>
      </div>

      <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        This display is designed for a 32&quot; landscape Insignia TV. Use browser/full-screen mode and bookmark the TV
        display link.
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {IN_STORE_MARKETING_SLIDES.map((slide, index) => (
          <article key={slide.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="relative aspect-video bg-stone-950">
              <Image src={slide.src} alt="" fill unoptimized className="object-cover" sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" />
            </div>
            <div className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-400">Slide {index + 1}</p>
              <h2 className="mt-1 text-lg font-bold text-stone-900">{slide.title}</h2>
              <p className="mt-1 text-sm text-stone-600">{slide.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/admin/in-store-marketing/tv?page=${index + 1}`}
                  target="_blank"
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Preview on TV ↗
                </Link>
                <Link
                  href={slide.src}
                  target="_blank"
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Open SVG ↗
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
