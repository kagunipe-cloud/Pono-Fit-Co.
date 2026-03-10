# Stripe webhook for ACH payment failures

When a member pays with **ACH Direct Debit** (bank transfer), funds take 3–5 business days to clear. We grant access immediately. If the payment fails (bounces), this webhook revokes access.

## Setup

1. **Stripe Dashboard** → Developers → Webhooks → Add endpoint
2. **Endpoint URL**: `https://your-app.com/api/stripe/webhook` (use your real domain)
3. **Events to send**: `payment_intent.payment_failed`
4. **Signing secret**: Copy the secret (starts with `whsec_`)
5. Add to env: `STRIPE_WEBHOOK_SECRET=whsec_...`

## What it does

When Stripe sends `payment_intent.payment_failed`:

- Finds the sale by `stripe_payment_intent_id`
- Sets sale status to `Payment Failed`
- Cancels subscriptions linked to that sale
- Revokes Kisi door access for the member

## ACH rules

ACH is offered when:
1. **Cart-only rule**: Cart contains only monthly membership plans, OR
2. **Option A**: Member has an active monthly membership (can use ACH for classes, PT, packs, etc.)

## Change payment method (card or ACH)

Members can switch to ACH (or add/update a card) via **My Membership** → **Change payment method**. Stripe Checkout in setup mode collects either card or bank account; the new method becomes the default for future renewals.
