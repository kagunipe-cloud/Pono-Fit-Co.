import type { CapacitorConfig } from "@capacitor/cli";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";

// So `npx cap sync` picks up the same URL as Next without manual exports.
loadDotenv({ path: resolve(process.cwd(), ".env.local") });
loadDotenv({ path: resolve(process.cwd(), ".env") });

const serverUrl =
  process.env.CAPACITOR_SERVER_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "";

/**
 * Remote URL: the WebView loads your deployed Next app (API routes + DB stay on the server).
 * Set NEXT_PUBLIC_APP_URL or CAPACITOR_SERVER_URL in .env.local (recommended).
 */
const config: CapacitorConfig = {
  appId: "co.ponofit.app",
  appName: "Pono Fit",
  webDir: "www",
  ...(serverUrl
    ? {
        server: {
          url: serverUrl.replace(/\/$/, ""),
          cleartext: serverUrl.startsWith("http:"),
        },
      }
    : {}),
  ios: {
    contentInset: "automatic",
    scheme: "ponofit",
  },
};

export default config;
