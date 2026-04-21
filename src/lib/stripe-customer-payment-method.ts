import Stripe from "stripe";

/**
 * Resolves a PaymentMethod `pm_…` to pass to `PaymentIntents.create`, or `null` to **omit**
 * `payment_method` so Stripe bills the Customer’s real default (including legacy `card_…` /
 * `default_source` when `paymentMethods.list` is empty).
 *
 * **Important:** We do **not** use `paymentMethods.list()[0]` when multiple cards exist but
 * `invoice_settings.default_payment_method` is unset — list order is not “the default”, and
 * forcing the wrong PM causes bogus declines (e.g. `incorrect_cvc`) while another card or
 * legacy default would succeed.
 */
export async function resolveStripeCustomerCardPaymentMethodId(
  stripe: Stripe,
  customerId: string
): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });

  if (typeof customer === "string" || customer.deleted) return null;

  const invPm = customer.invoice_settings?.default_payment_method;
  if (invPm) {
    const id = typeof invPm === "string" ? invPm : invPm.id;
    if (id.startsWith("pm_")) return id;
  }

  const list = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 100,
  });
  // Unambiguous: only one saved card and no explicit invoice default — this PM is what Stripe
  // would use when a single PaymentMethod is attached.
  if (list.data.length === 1) return list.data[0]!.id;

  // Several PMs but no invoice default: do not guess. Omit `payment_method` on the PI so Stripe
  // applies Customer default / legacy source; if nothing is set, Stripe returns a clear error.
  return null;
}

/**
 * When {@link resolveStripeCustomerCardPaymentMethodId} returns `null`, call this before
 * `PaymentIntents.create({ confirm: true, off_session: true })` without `payment_method`.
 * Otherwise Stripe often returns a confusing
 * "missing a payment method" / `payment_intent_unexpected_state` (e.g. **multiple** saved cards
 * and **no** default on the customer).
 *
 * @returns a human-readable blocker to store in `payment_failures`, or `null` to allow create
 *          (e.g. legacy `default_source` only, or single-card case resolve missed in edge cases).
 */
export async function getOffSessionRenewalBlockerIfResolvedPmIsNull(
  stripe: Stripe,
  customerId: string
): Promise<{ message: string; code: string } | null> {
  const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
  if (list.data.length >= 2) {
    return {
      message:
        "This member has more than one card on file, but no default in Stripe, so the app can’t choose which to charge. Set a default payment method on the customer in the Stripe Dashboard (or have them save a single card in the app).",
      code: "multiple_cards_no_default",
    };
  }
  if (list.data.length === 1) {
    // resolve() should have returned that pm_ — if not, still avoid blocking; PI create may work.
    return null;
  }
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["default_source", "invoice_settings.default_payment_method"],
  });
  if (typeof customer === "string" || customer.deleted) {
    return { message: "Stripe customer is missing or was deleted.", code: "customer_invalid" };
  }
  const inv = customer.invoice_settings?.default_payment_method;
  if (inv) {
    const id = typeof inv === "string" ? inv : inv.id;
    if (id.startsWith("pm_")) return null;
  }
  if (customer.default_source) {
    return null;
  }
  return {
    message:
      "No saved card in Stripe for this member (or no card the renewal can use off-session). Have them add or update a card in the app, then try again.",
    code: "no_card_for_renewal",
  };
}

/** Best-effort fields for payment_failures from a thrown Stripe API error (card decline, etc.). */
export function stripeFailureFieldsFromError(err: unknown): {
  message: string;
  stripe_error_code: string | null;
} {
  if (err && typeof err === "object") {
    const o = err as { message?: string; decline_code?: string; code?: string };
    const decline = typeof o.decline_code === "string" && o.decline_code.trim() ? o.decline_code.trim() : null;
    const code = typeof o.code === "string" && o.code.trim() ? o.code.trim() : null;
    const stripe_error_code = decline ?? code;
    const msg =
      typeof o.message === "string" && o.message.trim() ? o.message.trim() : "Payment failed";
    return { message: msg, stripe_error_code };
  }
  if (err instanceof Error) {
    return { message: err.message, stripe_error_code: null };
  }
  return { message: String(err), stripe_error_code: null };
}
