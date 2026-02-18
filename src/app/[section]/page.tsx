import { notFound } from "next/navigation";
import DataTable from "@/components/DataTable";
import { getTableData } from "@/lib/data";
import { getSection, type SectionSlug } from "@/lib/sections";

const VALID_SLUGS: SectionSlug[] = [
  "members",
  "money-owed",
  "live-dashboard",
  "pt-bookings",
  "class-bookings",
  "subscriptions",
  "shopping-cart",
  "sales",
  "pt-sessions",
  "classes",
  "membership-plans",
];

export function generateStaticParams() {
  return VALID_SLUGS.map((section) => ({ section }));
}

export const dynamicParams = true;

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ q?: string }> };

export default async function SectionPage({ params, searchParams }: Props) {
  const { section } = await params;
  const { q } = await searchParams;
  if (!VALID_SLUGS.includes(section as SectionSlug)) notFound();
  const config = getSection(section as SectionSlug);
  if (!config) notFound();

  const initialData = getTableData(config.slug, q ?? undefined);

  return (
    <DataTable
      sectionSlug={config.slug}
      title={config.title}
      description={config.description}
      columns={config.columns}
      searchPlaceholder={`Search ${config.title.toLowerCase()}...`}
      initialData={initialData}
      initialSearch={q ?? ""}
      actionHref={config.actionHref}
      actionLabel={config.actionLabel}
    />
  );
}
