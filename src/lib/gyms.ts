/**
 * Gyms (tenants): branding, waivers, feature flags, and Stripe Connect placeholder.
 * Each gym can have its own logo, colors, waiver PDF, and enabled features.
 * When adding Stripe Connect later, stripe_connect_account_id will hold the connected account.
 */

import { getDb } from "./db";

export type GymRow = {
  id: number;
  name: string;
  short_name: string;
  logo_url: string | null;
  theme_color: string | null;
  primary_color: string | null;
  waiver_pdf_url: string | null;
  waiver_text: string | null;
  features: string | null; // JSON: { "rec_leagues": true, "macros": true, "ai_calculate": true }
  stripe_connect_account_id: string | null;
  timezone: string | null;
  created_at: string | null;
};

/** Default feature flags when not specified. */
export const DEFAULT_FEATURES: Record<string, boolean> = {
  rec_leagues: true,
  macros: true,
  ai_calculate: true,
  journal: true,
  workouts: true,
  body_composition: true,
};

export function ensureGymsTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      logo_url TEXT,
      theme_color TEXT,
      primary_color TEXT,
      waiver_pdf_url TEXT,
      waiver_text TEXT,
      features TEXT,
      stripe_connect_account_id TEXT,
      timezone TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_id ON gyms(id);
  `);
  ensureDefaultGym(db);
}

function ensureDefaultGym(db: ReturnType<typeof getDb>) {
  const row = db.prepare("SELECT 1 FROM gyms WHERE id = 1").get();
  if (row) return;
  db.prepare(`
    INSERT INTO gyms (id, name, short_name, theme_color, primary_color, timezone)
    VALUES (1, 'Pono Fit Co.', 'Pono Fit', '#a2f4b1', '#a2f4b1', 'Pacific/Honolulu')
  `).run();
}

/** Get gym by id. Returns default gym (id=1) if not found. */
export function getGym(db: ReturnType<typeof getDb>, gymId: number | null): GymRow | null {
  const id = gymId ?? 1;
  const row = db.prepare("SELECT * FROM gyms WHERE id = ?").get(id) as GymRow | undefined;
  return row ?? null;
}

/** Get default gym (id=1). Used when tenant context is not yet available. */
export function getDefaultGym(db: ReturnType<typeof getDb>): GymRow {
  const row = getGym(db, 1);
  if (!row) throw new Error("Default gym not found. Run ensureGymsTable.");
  return row;
}

/** Parse features JSON. Returns merged with DEFAULT_FEATURES. */
export function parseGymFeatures(featuresJson: string | null): Record<string, boolean> {
  const out = { ...DEFAULT_FEATURES };
  if (!featuresJson?.trim()) return out;
  try {
    const parsed = JSON.parse(featuresJson) as Record<string, boolean>;
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = Boolean(v);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Check if a feature is enabled for the gym. */
export function isFeatureEnabled(gym: GymRow | null, feature: string): boolean {
  if (!gym) return DEFAULT_FEATURES[feature] ?? false;
  const features = parseGymFeatures(gym.features);
  return features[feature] ?? DEFAULT_FEATURES[feature] ?? false;
}

/** Branding for a gym. Used by /api/branding and for multi-tenant. Falls back to defaults. */
export type GymBranding = {
  name: string;
  shortName: string;
  logoUrl: string | null;
  themeColor: string;
  primaryColor: string;
};

export function getGymBranding(db: ReturnType<typeof getDb>, gymId: number | null): GymBranding {
  const gym = getGym(db, gymId ?? 1);
  return {
    name: gym?.name ?? "Pono Fit Co.",
    shortName: gym?.short_name ?? "Pono Fit",
    logoUrl: gym?.logo_url ?? null,
    themeColor: gym?.theme_color ?? "#a2f4b1",
    primaryColor: gym?.primary_color ?? "#a2f4b1",
  };
}

/** Default gym id. Use this until tenant context (subdomain, session, etc.) is implemented. */
export const DEFAULT_GYM_ID = 1;
