/**
 * Branding: name, PWA colors, and UI palette.
 * Edit brand-colors.json (project root) — that’s the single source for all of this.
 */

import brand from "../../brand-colors.json";

export const BRAND = {
  name: brand.name,
  shortName: brand.shortName,
  themeColor: brand.themeColor,
  backgroundColor: brand.backgroundColor,
  primary: brand.primary as Record<string, string> & { DEFAULT: string },
} as const;
