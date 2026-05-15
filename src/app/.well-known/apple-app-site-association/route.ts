import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * iOS Universal Links — must be reachable at
 * `https://<domain>/.well-known/apple-app-site-association`
 * (same domain as NEXT_PUBLIC_APP_URL).
 *
 * @see https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
 */
export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() || "WR2856Y6PW";
  const bundleId = process.env.IOS_BUNDLE_ID?.trim() || "co.ponofit.app";

  const body = {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ["*"],
        },
      ],
    },
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
