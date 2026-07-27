import Stripe from "stripe";
import {
  getOffSessionRenewalBlockerIfResolvedPmIsNull,
  resolveStripeCustomerCardPaymentMethodId,
} from "./stripe-customer-payment-method";

export type OffSessionCartChargeResult =
  | { ok: true; payment_intent_id: string }
  | { ok: false; error: string; status: number; stripe_error_code?: string | null };

/** Create and confirm an off-session PaymentIntent for a cart total (saved card on Stripe Customer). */
export async function chargeCartOffSession(params: {
  stripe: Stripe;
  stripeCustomerId: string;
  amountCents: number;
  member_id: string;
  taxDollars: number;
  hasMonthlyMembershipInCart: boolean;
  monthly_recurring: boolean;
  promoCode: string | null;
  scheduled_cart_charge_id?: number;
  staffInitiated?: boolean;
}): Promise<OffSessionCartChargeResult> {
  const {
    stripe,
    stripeCustomerId,
    amountCents,
    member_id,
    taxDollars,
    hasMonthlyMembershipInCart,
    monthly_recurring,
    promoCode,
    scheduled_cart_charge_id,
    staffInitiated,
  } = params;

  if (amountCents < 50) {
    return { ok: false, error: "Amount must be at least $0.50", status: 400 };
  }

  const paymentMethodId = await resolveStripeCustomerCardPaymentMethodId(stripe, stripeCustomerId);
  if (!paymentMethodId) {
    const blocker = await getOffSessionRenewalBlockerIfResolvedPmIsNull(stripe, stripeCustomerId);
    if (blocker) {
      return { ok: false, error: blocker.message, status: 400, stripe_error_code: blocker.code };
    }
  }

  try {
    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      off_session: true,
      confirm: true,
      description: scheduled_cart_charge_id
        ? `Scheduled cart charge #${scheduled_cart_charge_id}`
        : staffInitiated
          ? "Cart (saved card, staff)"
          : "Cart (saved card on file)",
      metadata: {
        member_id,
        type: scheduled_cart_charge_id ? "scheduled_cart" : "cart_off_session",
        ...(scheduled_cart_charge_id ? { scheduled_cart_charge_id: String(scheduled_cart_charge_id) } : {}),
        ...(taxDollars > 0 ? { tax_amount: taxDollars.toFixed(2) } : {}),
        ...(hasMonthlyMembershipInCart ? { monthly_recurring: monthly_recurring ? "1" : "0" } : {}),
        ...(promoCode ? { promo_code: promoCode } : {}),
      },
    };
    if (paymentMethodId) {
      piParams.payment_method = paymentMethodId;
    }

    const pi = await stripe.paymentIntents.create(piParams);

    if (pi.status === "succeeded") {
      return { ok: true, payment_intent_id: pi.id };
    }
    if (pi.status === "requires_action" || pi.status === "processing") {
      return {
        ok: false,
        error:
          "The bank needs extra verification for this card. Ask the member to use Pay with Stripe on this cart, or pay at the reader.",
        status: 409,
      };
    }
    const errMsg =
      typeof pi.last_payment_error?.message === "string" && pi.last_payment_error.message.trim()
        ? pi.last_payment_error.message
        : `Payment not completed (status: ${pi.status})`;
    const stripeCode = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? null;
    return { ok: false, error: errMsg, status: 400, stripe_error_code: stripeCode };
  } catch (err) {
    console.error("[cart-off-session-charge]", err);
    const message = err instanceof Error ? err.message : "Failed to charge card";
    let stripeCode: string | null = null;
    if (err && typeof err === "object" && "code" in err) {
      stripeCode = String((err as { code?: string }).code ?? "");
    }
    return { ok: false, error: message, status: 500, stripe_error_code: stripeCode };
  }
}
