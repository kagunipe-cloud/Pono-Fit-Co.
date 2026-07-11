/** Token for legacy `/lobby-tv/<token>` redirects to `/ismtv`. */
export function getInStoreMarketingTvToken(): string | null {
  const token =
    process.env.IN_STORE_MARKETING_TV_TOKEN?.trim() ||
    process.env.BOARD_TV_TOKEN?.trim() ||
    "";
  return token || null;
}

export function isValidInStoreMarketingTvToken(token: string): boolean {
  const expected = getInStoreMarketingTvToken();
  if (!expected) return false;
  return token === expected;
}
