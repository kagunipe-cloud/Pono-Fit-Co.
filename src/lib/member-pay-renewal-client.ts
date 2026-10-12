import { EXISTING_MONTHLY_MEMBERSHIP_CODE } from "./monthly-membership-stack";

export function isExistingMonthlyMembershipBlock(json: Record<string, unknown>): boolean {
  return json.code === EXISTING_MONTHLY_MEMBERSHIP_CODE;
}

/** Shared client helper for POST /api/member/pay-renewal */
export async function postMemberPayRenewal(subscriptionId?: string | null): Promise<{
  ok: boolean;
  message: string;
}> {
  const res = await fetch("/api/member/pay-renewal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription_id: subscriptionId ?? undefined }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, message: (json.message as string) ?? "Payment received. Thank you!" };
  }
  return { ok: false, message: (json.error as string) ?? "Payment failed." };
}
