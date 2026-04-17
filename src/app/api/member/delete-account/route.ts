import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersAccountDeletedAtColumn } from "@/lib/db";
import { ensureMembersPassActivationDayColumn } from "@/lib/day-pass-credits";
import { getMemberIdFromSession, clearMemberSession } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { isNativeAppStoreClient } from "@/lib/native-app-request";
import {
  memberHasRetentionHistory,
  hardDeleteMemberRow,
  softDeleteAnonymizeMember,
} from "@/lib/member-account-deletion";
import { deleteKisiUserBestEffort } from "@/lib/kisi";

export const dynamic = "force-dynamic";

/**
 * Self-service account deletion (App Store). Only accepted from the native Capacitor shell
 * (PonoFitNativeApp User-Agent). Requires current password.
 * Hard-deletes the row if the member has no billing/booking history; otherwise anonymizes PII.
 */
export async function POST(request: NextRequest) {
  if (!isNativeAppStoreClient(request)) {
    return NextResponse.json(
      { error: "Account deletion is only available in the Pono Fit mobile app." },
      { status: 403 }
    );
  }

  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json({ error: "Enter your current password to delete your account." }, { status: 400 });
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    ensureMembersAccountDeletedAtColumn(db);
    ensureMembersPassActivationDayColumn(db);

    const row = db
      .prepare(
        `SELECT id, member_id, role, password_hash, account_deleted_at, kisi_id
         FROM members WHERE member_id = ?`
      )
      .get(memberId) as
      | {
          id: number;
          member_id: string;
          role: string | null;
          password_hash: string | null;
          account_deleted_at: string | null;
          kisi_id: string | null;
        }
      | undefined;

    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if ((row.account_deleted_at ?? "").trim()) {
      db.close();
      await clearMemberSession();
      return NextResponse.json({ error: "This account is already closed." }, { status: 410 });
    }

    const role = row.role ?? "Member";
    if (role === "Admin") {
      db.close();
      return NextResponse.json(
        { error: "Staff accounts cannot be deleted from the member app. Contact support." },
        { status: 403 }
      );
    }

    const hash = (row.password_hash ?? "").trim();
    if (!hash) {
      db.close();
      return NextResponse.json(
        {
          error: "Set a password on your profile first, then you can delete your account.",
          code: "PASSWORD_NOT_SET",
        },
        { status: 400 }
      );
    }

    if (!verifyPassword(password, hash)) {
      db.close();
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    const internalId = row.id;
    const mid = row.member_id;
    const kisiId = row.kisi_id?.trim() || null;

    const hasHistory = memberHasRetentionHistory(db, mid);

    if (!hasHistory) {
      if (kisiId) {
        try {
          await deleteKisiUserBestEffort(kisiId);
        } catch (e) {
          console.error("[delete-account] Kisi before hard delete:", e);
        }
      }
      hardDeleteMemberRow(db, internalId);
      db.close();
      await clearMemberSession();
      return NextResponse.json({ ok: true, mode: "removed" });
    }

    await softDeleteAnonymizeMember(db, internalId, mid);
    db.close();
    await clearMemberSession();
    return NextResponse.json({
      ok: true,
      mode: "anonymized",
      message:
        "Your account is closed and personal details were removed. Some purchase history may be retained for records.",
    });
  } catch (err) {
    console.error("[delete-account]", err);
    return NextResponse.json({ error: "Could not delete account." }, { status: 500 });
  }
}
