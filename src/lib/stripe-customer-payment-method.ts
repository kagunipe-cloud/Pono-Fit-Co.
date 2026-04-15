import Stripe from "stripe";

/**
 * Stripe can charge a customer whose default card is set on the Customer (e.g. Checkout
 * "save as default") even when `paymentMethods.list({ type: "card" })` is empty — e.g. legacy
 * `card_…` sources or default only on invoice settings. This resolves a PaymentMethod id to pass
 * to PaymentIntents, or null if none found (caller may omit `payment_method` so Stripe uses the
 * customer default).
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
    limit: 20,
  });
  if (list.data.length > 0) return list.data[0].id;

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
