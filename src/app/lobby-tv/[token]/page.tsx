import { notFound, redirect } from "next/navigation";
import { isValidInStoreMarketingTvToken } from "@/lib/in-store-marketing-tv-access";

/** Legacy token URL — redirects to `/ismtv`. */
export default async function LobbyTvRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const token = (await params).token ?? "";
  if (!isValidInStoreMarketingTvToken(token)) notFound();

  const page = (await searchParams).page;
  const dest = page ? `/ismtv?page=${encodeURIComponent(page)}` : "/ismtv";
  redirect(dest);
}
