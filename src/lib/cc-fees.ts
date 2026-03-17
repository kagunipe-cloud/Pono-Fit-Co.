/**
 * Credit card processing fee (Square-style): 3% + $0.30 per transaction.
 * Applied to the subtotal (after discounts) before checkout.
 */
export const CC_FEE_PERCENT = 3;
export const CC_FEE_FIXED_CENTS = 30;

/** Compute CC fee in dollars for a given subtotal in dollars. */
export function computeCcFee(subtotalDollars: number): number {
  if (subtotalDollars <= 0) return 0;
  const percentFee = subtotalDollars * (CC_FEE_PERCENT / 100);
  const fixedFee = CC_FEE_FIXED_CENTS / 100;
  return Math.round((percentFee + fixedFee) * 100) / 100;
}
