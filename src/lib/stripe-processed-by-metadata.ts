import type { NextRequest } from "next/server";
import { getAdminMemberId, getTrainerMemberId } from "./admin";
import { getMemberIdFromSession } from "./session";

/** Stripe PaymentIntent / Checkout metadata: Fox Says member_id who initiated the payment. */
export const STRIPE_PROCESSED_BY_MEMBER_ID = "processed_by_member_id";
/** `admin` | `staff` | `member` — role of processed_by at charge time. */
export const STRIPE_PROCESSED_BY_ROLE = "processed_by_role";

export type StripeProcessedByRole = "admin" | "staff" | "member";

export function buildStripeProcessedByMetadata(
  processedByMemberId: string | null | undefined,
  role: StripeProcessedByRole | null | undefined
): Record<string, string> {
  const id = processedByMemberId?.trim();
  if (!id) return {};
  const out: Record<string, string> = { [STRIPE_PROCESSED_BY_MEMBER_ID]: id };
  if (role) out[STRIPE_PROCESSED_BY_ROLE] = role;
  return out;
}

/** Staff at the desk (trainer or admin) initiating payment for a member cart. */
export async function processedByStaffFromRequest(request: NextRequest): Promise<Record<string, string>> {
  const staffId = await getTrainerMemberId(request);
  if (!staffId) return {};
  const isAdmin = !!(await getAdminMemberId(request));
  return buildStripeProcessedByMetadata(staffId, isAdmin ? "admin" : "staff");
}

/** Staff checkout vs member self-serve on member cart routes. */
export async function processedByFromCartRequest(
  request: NextRequest,
  cartMemberId: string
): Promise<Record<string, string>> {
  const staffMeta = await processedByStaffFromRequest(request);
  if (Object.keys(staffMeta).length > 0) return staffMeta;
  const sessionMemberId = await getMemberIdFromSession();
  if (sessionMemberId && sessionMemberId === cartMemberId) {
    return buildStripeProcessedByMetadata(sessionMemberId, "member");
  }
  return {};
}
