import Link from "next/link";
import InStoreMarketingAdminClient from "@/components/admin/InStoreMarketingAdminClient";

export const metadata = {
  title: "In-Store Marketing | Pono Fit Co.",
};

const PUBLIC_TV_PATH = "/ismtv";

export default function InStoreMarketingAdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">In-Store Marketing</h1>
          <p className="mt-1 text-sm text-stone-600">
            Manage what rotates on the lobby TV. Add or remove slides here — the TV keeps the same bookmark.
          </p>
        </div>
        <Link
          href={PUBLIC_TV_PATH}
          target="_blank"
          className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-[#9ef6b2] hover:bg-stone-800"
        >
          Open TV Display ↗
        </Link>
      </div>

      <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p>
          Bookmark this on the Insignia TV:{" "}
          <Link href={PUBLIC_TV_PATH} target="_blank" className="font-medium text-brand-700 underline">
            https://app.beponofitco.com{PUBLIC_TV_PATH}
          </Link>
        </p>
        <p className="mt-2">Each slide shows for 30 seconds. Changes here apply without changing that URL.</p>
      </div>

      <InStoreMarketingAdminClient />
    </div>
  );
}
