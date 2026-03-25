/**
 * Stripe Dashboard "guest" customers use ids like `gcus_...`. Those are read-only
 * groupings and are not valid for API parameters such as Checkout `customer` or
 * off-session charges. Only real Customer objects (`cus_...`) can be used.
 * @see https://docs.stripe.com/payments/checkout/guest-customers
 */
export function stripeCustomerIdForApi(
  id: string | null | undefined
): string | undefined {
  const t = id?.trim();
  if (!t) return undefined;
  if (t.startsWith("gcus_")) return undefined;
  return t;
}

/** True when we have a Stripe Customer id that the API can bill (not guest-only). */
export function hasBillableStripeCustomer(id: string | null | undefined): boolean {
  return !!stripeCustomerIdForApi(id);
}
