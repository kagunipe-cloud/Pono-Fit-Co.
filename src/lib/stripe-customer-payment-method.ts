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
