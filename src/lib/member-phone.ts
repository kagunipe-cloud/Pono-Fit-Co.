import { getDb } from "./db";

export const PT_BOOKING_PHONE_REQUIRED_MESSAGE = "A phone number is required to book PT.";

export function memberPhoneOnFile(phone: string | null | undefined): boolean {
  return !!(phone ?? "").trim();
}

export function normalizeMemberPhoneInput(
  raw: string
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim().slice(0, 40);
  if (!value) {
    return { ok: false, message: PT_BOOKING_PHONE_REQUIRED_MESSAGE };
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) {
    return { ok: false, message: "Please enter a valid phone number (at least 7 digits)." };
  }
  return { ok: true, value };
}

/** Members booking PT for themselves must have a phone on file. */
export function memberPtBookingPhoneError(
  db: ReturnType<typeof getDb>,
  memberId: string,
  opts: { isAdmin?: boolean; memberSelfBooking?: boolean }
): string | null {
  if (opts.isAdmin) return null;
  if (opts.memberSelfBooking === false) return null;
  const row = db.prepare("SELECT phone FROM members WHERE member_id = ?").get(memberId) as
    | { phone: string | null }
    | undefined;
  if (memberPhoneOnFile(row?.phone)) return null;
  return PT_BOOKING_PHONE_REQUIRED_MESSAGE;
}
