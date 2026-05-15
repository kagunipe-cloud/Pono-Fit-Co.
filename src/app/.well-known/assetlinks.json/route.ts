import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Android App Links verification file.
 * `sha256_cert_fingerprints`: Play App Signing cert (and/or upload key) colon-separated hex; comma-separated for multiple.
 *
 * @see https://developer.android.com/training/app-links/verify-android-applinks
 */
export function GET() {
  const packageName = process.env.ANDROID_APP_LINK_PACKAGE?.trim() || "co.ponofit.app";
  const raw = process.env.ANDROID_SHA256_CERT_FINGERPRINTS?.trim();

  const fingerprints = raw
    ? raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  const body =
    fingerprints.length > 0
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
