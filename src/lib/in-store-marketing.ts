import type { getDb } from "./db";

export type InStoreMarketingSlide = {
  id: string;
  title: string;
  description: string;
  src: string;
};

/** Built-in landscape assets admins can add to the TV rotation. */
export const IN_STORE_MARKETING_CATALOG: InStoreMarketingSlide[] = [
  {
    id: "small-group-training",
    title: "Small-Group Training",
    description: "$100/hour total for up to 4 people. Native 16:9 remake of the marketing graphic.",
    src: "/marketing/in-store-tv/small-group-training.png",
  },
  {
    id: "fitness-assessment",
    title: "Fitness Assessment",
    description: "$125/90 minute session. Goal consult, FMS, exercise analysis, optional VO2 max, and a 1-3 month plan.",
    src: "/marketing/in-store-tv/fitness-assessment.png",
  },
  {
    id: "pnf-stretching",
    title: "Proprioceptive Neuromuscular Facilitation",
    description: "$50 full body session. Mobility expanding stretching for athletes and those who move.",
    src: "/marketing/in-store-tv/pnf-stretching.png",
  },
  {
    id: "zen-iv-wellness",
    title: "Zen IV & Wellness Session",
    description: "Saturday 8/29, 2–3 PM. Breathwork, sound-healing, and B12 shot included. $40.",
    src: "/marketing/zen-iv-wellness-tv.svg",
  },
];

/** @deprecated Use loadActiveInStoreMarketingSlides(db) for the TV display. */
export const IN_STORE_MARKETING_SLIDES = IN_STORE_MARKETING_CATALOG;

export const IN_STORE_MARKETING_SETTINGS_KEY = "in_store_marketing_slides";

export type StoredMarketingSlide = {
  id: string;
  title?: string;
  description?: string;
  src?: string;
  enabled: boolean;
};

export type InStoreMarketingRotationRow = InStoreMarketingSlide & {
  enabled: boolean;
  inCatalog: boolean;
};

function catalogById(): Map<string, InStoreMarketingSlide> {
  return new Map(IN_STORE_MARKETING_CATALOG.map((s) => [s.id, s]));
}

/** Matches production before admin-managed rotation: the original three slides. */
export function defaultMarketingRotation(): StoredMarketingSlide[] {
  return IN_STORE_MARKETING_CATALOG.slice(0, 3).map((s) => ({ id: s.id, enabled: true }));
}

export function readStoredMarketingRotation(db: ReturnType<typeof getDb>): StoredMarketingSlide[] {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(IN_STORE_MARKETING_SETTINGS_KEY) as
    | { value: string }
    | undefined;
  const raw = row?.value?.trim();
  if (!raw) return defaultMarketingRotation();
  try {
    const parsed = JSON.parse(raw) as StoredMarketingSlide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultMarketingRotation();
    return parsed
      .filter((s) => s && typeof s.id === "string" && s.id.trim())
      .map((s) => ({
        id: s.id.trim(),
        title: s.title?.trim() || undefined,
        description: s.description?.trim() || undefined,
        src: s.src?.trim() || undefined,
        enabled: s.enabled !== false,
      }));
  } catch {
    return defaultMarketingRotation();
  }
}

export function saveMarketingRotation(db: ReturnType<typeof getDb>, slides: StoredMarketingSlide[]) {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    IN_STORE_MARKETING_SETTINGS_KEY,
    JSON.stringify(slides)
  );
}

function resolveSlide(stored: StoredMarketingSlide, catalog: Map<string, InStoreMarketingSlide>): InStoreMarketingSlide | null {
  const fromCatalog = catalog.get(stored.id);
  if (fromCatalog) return fromCatalog;
  if (stored.src?.startsWith("/marketing/") || stored.src?.startsWith("/api/in-store-marketing/asset/")) {
    if (!stored.title || !stored.src) return null;
    return {
      id: stored.id,
      title: stored.title,
      description: stored.description ?? "",
      src: stored.src,
    };
  }
  return null;
}

/** Active slides for `/ismtv` in display order. */
export function loadActiveInStoreMarketingSlides(db: ReturnType<typeof getDb>): InStoreMarketingSlide[] {
  const catalog = catalogById();
  const stored = readStoredMarketingRotation(db);
  const active: InStoreMarketingSlide[] = [];
  for (const row of stored) {
    if (!row.enabled) continue;
    const slide = resolveSlide(row, catalog);
    if (slide) active.push(slide);
  }
  return active.length > 0 ? active : IN_STORE_MARKETING_CATALOG.slice(0, 3);
}

/** Full rotation config for admin (catalog + custom uploads). */
export function loadInStoreMarketingRotationAdmin(db: ReturnType<typeof getDb>): InStoreMarketingRotationRow[] {
  const catalog = catalogById();
  const stored = readStoredMarketingRotation(db);
  const seen = new Set<string>();
  const rows: InStoreMarketingRotationRow[] = [];

  for (const row of stored) {
    const slide = resolveSlide(row, catalog);
    if (!slide) continue;
    seen.add(row.id);
    rows.push({
      ...slide,
      enabled: row.enabled,
      inCatalog: catalog.has(row.id),
    });
  }

  for (const cat of IN_STORE_MARKETING_CATALOG) {
    if (seen.has(cat.id)) continue;
    rows.push({ ...cat, enabled: false, inCatalog: true });
  }

  return rows;
}

export function normalizeMarketingRotationPatch(body: unknown): StoredMarketingSlide[] | null {
  if (!body || typeof body !== "object") return null;
  const slides = (body as { slides?: unknown }).slides;
  if (!Array.isArray(slides)) return null;
  const out: StoredMarketingSlide[] = [];
  for (const item of slides) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as StoredMarketingSlide).id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      title: (item as StoredMarketingSlide).title?.trim() || undefined,
      description: (item as StoredMarketingSlide).description?.trim() || undefined,
      src: (item as StoredMarketingSlide).src?.trim() || undefined,
      enabled: (item as StoredMarketingSlide).enabled !== false,
    });
  }
  return out.length > 0 ? out : null;
}
