import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";

export const dynamic = "force-dynamic";

const DOCUMENT_KEYS = [
  "document_privacy_html",
  "document_terms_html",
  "document_gym_waiver_html",
  "document_privacy_file",
  "document_terms_file",
  "document_gym_waiver_file",
] as const;

const EMAIL_KEYS = [
  "email_post_purchase_subject",
  "email_post_purchase_body",
  "email_membership_expiry_subject",
  "email_membership_expiry_body",
  "email_app_download_subject",
  "email_app_download_body",
  "email_liability_waiver_subject",
  "email_liability_waiver_body",
  "email_booking_confirmation_subject",
  "email_booking_confirmation_body",
  "email_booking_trainer_assigned_subject",
  "email_booking_trainer_assigned_body",
] as const;

function getSetting(db: ReturnType<typeof getDb>, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value?.trim() ?? null;
}

function setSetting(db: ReturnType<typeof getDb>, key: string, value: string | null) {
  if (value === null || value === "") {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  } else {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}

/** Default email templates and document descriptions (used when custom is empty). */
const DEFAULTS: Record<string, string> = {
  email_post_purchase_subject: "Welcome to our 'Ohana",
  email_post_purchase_body: `Hi{{first_name}},

Thanks for your purchase. You can view your membership and bookings in the app.

Download the app (open on your phone to add to home screen):
{{install_url}}

Your Member ID: {{member_id}}

To sign in for the first time, set your password here:
{{set_password_url}}

After that you'll sign in with your email and password.{{receipt}}

— Pono Fit Co.`,
  email_membership_expiry_subject: "Your membership is expiring soon",
  email_membership_expiry_body: `Aloha,

Bekah & Perry with Pono Fit Co. here! We're just emailing to let you know that your membership expires on {{expiry_date}}. {{card_message}}

Mahalo Nui Loa,

B & P`,
  email_app_download_subject: "Get the Pono Fit Co. app",
  email_app_download_body: `Hi{{first_name}},

Download our app to view your membership, book classes, and more:

{{install_url}}

Open this link on your phone and follow the steps to add the app to your home screen.

Your Member ID: {{member_id}}

To sign in for the first time, set your password here:
{{set_password_url}}

After that you'll sign in with your email and password.

— Pono Fit Co.`,
  email_liability_waiver_subject: "Sign your liability waiver to get door access",
  email_liability_waiver_body: `Hi{{first_name}},

Please sign the liability waiver to activate your door access. Open the link below (valid for 14 days):

{{waiver_url}}

— Pono Fit Co.`,
  email_booking_confirmation_subject: "Booking confirmed: {{session_title}} — {{date}}",
  email_booking_confirmation_body: `Hi{{first_name}},

Your booking is confirmed.

{{session_title}} ({{kind_label}})
Date: {{date}}
Time: {{time}}
Trainer: {{trainer}}

You can view details in the {{brand_short}} app.

— {{brand_name}}`,
  email_booking_trainer_assigned_subject: "Trainer assigned: {{session_title}} — {{date}}",
  email_booking_trainer_assigned_body: `Hi{{first_name}},

A trainer has been assigned to your session.

{{session_title}} ({{kind_label}})
Date: {{date}}
Time: {{time}}
Trainer: {{trainer}}

You can view details in the {{brand_short}} app.

— {{brand_name}}`,
  document_privacy_default: "Built-in privacy policy (see /privacy page when no custom content).",
  document_terms_default: "Built-in terms of service (see /terms page when no custom content).",
  document_gym_waiver_default: "waiver.pdf from public folder (or custom upload/text above).",
};

/** GET — admin: emails & documents settings + defaults. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const settings: Record<string, string | null> = {};
    for (const key of [...DOCUMENT_KEYS, ...EMAIL_KEYS]) {
      settings[key] = getSetting(db, key);
    }
    db.close();
    return NextResponse.json({ ...settings, defaults: DEFAULTS });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

/** PATCH — admin: update emails & documents. Body: partial settings object. */
export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const db = getDb();
    const allKeys = [...DOCUMENT_KEYS, ...EMAIL_KEYS];
    for (const key of allKeys) {
      const v = body[key];
      if (v === undefined) continue;
      const value = typeof v === "string" ? v : v === null ? null : String(v);
      setSetting(db, key, value ?? null);
    }
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
