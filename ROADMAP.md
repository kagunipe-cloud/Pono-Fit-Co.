# The Fox Says — Gym Management App Roadmap

## Vision
Single interface to manage **members**, **offerings** (plans, classes, PT, products), and **bookings**. Members can be assigned subscriptions, class/PT bookings, and one-off purchases via a **shopping cart** that connects to **Stripe** for payment. Memberships support **durations**, **expiry notifications**, and optional **auto-billing**.

---

## Data model (current + planned)

| Area | Tables | Links |
|------|--------|--------|
| **Members** | `members` | → subscriptions, sales, class_bookings, pt_bookings, shopping_cart |
| **Offerings** | `membership_plans`, `classes`, `pt_sessions` (+ products if needed) | Referenced by subscriptions, bookings, cart |
| **Commerce** | `sales`, `shopping_cart` | sales → member_id; cart line items → member when assigned |
| **Bookings** | `class_bookings`, `pt_bookings`, `subscriptions` | member_id, product_id, dates, payment_status |

**Planned additions:**
- `subscriptions.auto_bill` (boolean) for optional auto-charge on expiry
- Optional `products` table for retail (or reuse existing structure)
- Stripe: store `payment_intent_id` / `customer_id` on members or sales as needed

---

## Phases

### Phase 1 — Member hub + linked data ✅
- **Member list** with “Add member” and link to detail.
- **Member detail page**: profile (name, email, join date, etc.) plus:
  - **Subscriptions** (with plan name, start/expiry, status)
  - **Class bookings** and **PT bookings**
  - **Purchase history** (sales)
- **Add member** form (name, email, etc.) and **Edit member**.
- No checkout yet; just interconnect members ↔ subscriptions ↔ bookings ↔ sales.

### Phase 2 — Cart + checkout flow
- **Cart** is member-scoped: “Cart for [Member]” with line items (plan, class, PT, product).
- **Add to cart** from:
  - Member detail: “Sell to this member” → add items → cart.
  - Or from offerings: pick member, then add items.
- **Cart page**: list items, quantities, totals; **Checkout** button.
- Checkout creates **Sale** and related records (subscription, bookings) and clears cart. Payment in Phase 3.

### Phase 3 — Stripe
- **Stripe API** (env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
- **Checkout**: create PaymentIntent (or Checkout Session), redirect or embed Stripe Elements; on success confirm sale and create subscriptions/bookings.
- **Members**: optional `stripe_customer_id` for saved cards and auto-billing later.
- **Webhooks**: payment_intent.succeeded → mark sale paid, fulfill subscription/booking.

### Phase 4 — Memberships: duration, expiry, auto-bill
- **Membership plans**: duration (e.g. 1 month, 3 months) already in DB; surface in UI.
- **Subscriptions**: show **expiry date** and **days remaining**; **Expiring soon** dashboard (e.g. next 7/30 days).
- **Notifications**: in-app (and later email) when a membership is expiring; list of “Expiring soon” and “Expired”.
- **Auto-bill**: per subscription, flag “Auto-bill when expired”. When expiry is reached, create renewal charge via Stripe (customer_id + saved payment) and new subscription row; optional reminder before charging.

---

## Tech stack
- **App:** Next.js (App Router), Tailwind, React.
- **DB:** SQLite (better-sqlite3); run `npm run import` after CSV updates.
- **Payments:** Stripe (Payment Intents / Checkout; webhooks for fulfilment).

---

## Current status
- ✅ CSV import for all tables.
- ✅ Member CRUD + member detail with linked subscriptions, class bookings, PT bookings, sales.
- ✅ **Offerings CRUD**: Membership plans, PT sessions, Classes — add, edit, delete (duration on plans).
- ✅ **Cart flow**: Member → "Add to cart / Sell" → add membership/class/PT → "Payment received — activate & notify Kisi" (creates subscription/booking, sale, Kisi placeholder).
- 🔲 **Stripe reader**: When payment succeeds (Terminal or webhook), call `POST /api/cart/confirm-payment` with `{ "member_id": "..." }`, or use the in-app button after taking payment.
- 🔲 **Kisi**: Set `KISI_API_KEY` in env; implement `notifyKisiForAccess` in `src/app/api/cart/confirm-payment/route.ts` per [Kisi API](https://api.kisi.io/docs).
