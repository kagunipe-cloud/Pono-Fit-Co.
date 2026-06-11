/**
 * Public App Store product URL for the native iOS app
 *(e.g. https://apps.apple.com/app/... ).
 *
 * When unset or invalid, install UI falls back to Safari “Add to Home Screen” (PWA).
 */
export function getIosAppStoreUrl(): string | null {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_IOS_APP_STORE_URL : undefined;
  const u = typeof raw === "string" ? raw.trim() : "";
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Placeholders for welcome / post-purchase emails (`{{install_url}}`, `{{ios_app_store_url}}`, `{{install_instructions}}`). */
export function getEmailInstallTemplateVars(origin: string): {
  install_url: string;
  ios_app_store_url: string;
  install_instructions: string;
} {
  const originClean = origin.replace(/\/$/, "");
  const install_url = `${originClean}/install`;
  const ios_app_store_url = getIosAppStoreUrl() ?? "";
  const install_instructions = ios_app_store_url
    ? `iPhone/iPad — download from the App Store:\n${ios_app_store_url}\n\nAndroid or add-to-home-screen help:\n${install_url}`
    : `Open on your phone to install:\n${install_url}`;
  return { install_url, ios_app_store_url, install_instructions };
}
