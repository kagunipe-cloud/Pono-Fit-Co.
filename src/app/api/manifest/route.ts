import { BRAND } from "../../../lib/branding";
import { NextResponse } from "next/server";

export function GET() {
  const manifest = {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: "Gym membership, classes, PT, and door access",
    start_url: "/",
    display: "standalone",
    background_color: BRAND.backgroundColor,
    theme_color: BRAND.themeColor,
    orientation: "portrait-primary",
    icons: [
      { src: "/Lei_Logos.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/Lei_Logos.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/Lei_Logos.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "application/manifest+json",
    },
  });
}
