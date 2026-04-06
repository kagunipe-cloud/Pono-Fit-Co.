# Post-migration checklist: Glofox → Stripe + auto-renew in The Fox Says

Use this after **Glofox coordinates a Stripe data migration** into **your** Stripe account. It aligns your **app database** with what the **renewal cron** actually needs.

## How renewals work in this app (important)

- The app does **not** rely on Stripe **Billing Subscriptions** (`sub_xxx`) for monthly charges.
- Renewals are driven by:
  1. A row in the **`subscriptions`** table (`status = 'Active'`, correct `product_id`, `expiry_date`).
  2. The linked **`membership_plans`** row must have **`unit = 'Month'`** (only monthly plans are auto-charged by cron).
  3. **`members.stripe_customer_id`** set to the Stripe Customer id (`cus_...`).
  4. At least one **card** payment method on that customer in Stripe.
  5. **`members.auto_renew = 1`** (the “opt-in for auto-renewal” checkbox on the member profile).

The cron job (`/api/cron/renew-subscriptions`) finds subscriptions whose **`expiry_date` equals today** (in the gym timezone), then charges the **first** card on file via **PaymentIntent** (off-session). It does **not** read Stripe’s subscription objects.

So: **Stripe migration gives you customers + cards; this app still needs correct `subscriptions` rows + `auto_renew`.**

---

## Phase 1 — After Stripe migration completes

### 1. Stripe Dashboard sanity checks

For a **sample** of members (and eventually everyone who should auto-renew):

| Check | Where |
|--------|--------|
| Customer exists | **Customers** — email matches member in your app |
| Default / saved card | Customer → **Payment methods** — at least one **Card** |
| Customer id | Copy `cus_...` — this must match **`members.stripe_customer_id`** |

### 2. Link Stripe Customer id to each member

Migration may give you a **spreadsheet** (email → `cus_xxx`). Your app stores this on **`members.stripe_customer_id`**.

- **Option A:** Admin updates via your existing member edit flow (if you expose Stripe id), or direct DB update for bulk.
- **Option B:** One-time script/CSV import **you** run — not part of the default app UI today.

**Rule:** Every member who should be charged must have **`stripe_customer_id`** = their **new** account customer id (after migration).

### 3. Verify payment methods

The renewal code uses `paymentMethods.list({ customer, type: 'card' })` and charges the **first** card.

- If a customer has **no** card in Stripe, renewal **skips** (recorded in payment failures / cron details).
- After migration, confirm cards appear under the customer (not only “legacy” sources if Stripe shows both).

---

## Phase 2 — Subscriptions in **this** app

The Glofox CSV import sets **`members.exp_next_payment_date`** only. It does **not** create **`subscriptions`** rows.

### When you need a `subscriptions` row

The renewal cron **only** processes **`subscriptions`**. If a member has:

- `stripe_customer_id` + card + `auto_renew = 1`

…but **no** Active **`subscriptions`** row for their monthly plan, **nothing** will charge.

### How rows are normally created

- **Checkout:** Member (or staff cart) buys a membership → `confirm-payment` inserts **`subscriptions`**.
- **Complimentary:** Admin **Complimentary** flow on a member can create an Active subscription for a **`membership_plans`** product.

### Backfill strategy (choose one)

1. **Let members check out once** in the new system (cleanest; creates `subscriptions` + sale).
2. **Admin complimentary** per member/plan for “credit” periods while aligning dates (uses same insert shape as checkout).
3. **Bulk SQL / import** — only if you’re comfortable: insert `subscription_id` (short unique string), `member_id`, `product_id` (must match **`membership_plans.product_id`**), `status = 'Active'`, `start_date`, `expiry_date`, `days_remaining`, `price`, `quantity`. **Wrong `product_id` breaks joins and renewal pricing.**

Always set **`members.exp_next_payment_date`** to the same **next renewal** date you expect, or rely on **`COALESCE`** in the API (profile still prefers explicit member field when set).

### Monthly-only rule

Cron **only** renews plans where **`membership_plans.unit = 'Month'`**. Yearly / week / day plans are **not** picked up by this job.

---

## Phase 3 — Auto-renew checkbox

On **Members → [member]**:

- Enable **“Opt-in for auto-renewal (charge saved card when membership expires)”**.

This sets **`members.auto_renew = 1`**. It does **not** create subscriptions or Stripe objects by itself.

---

## Phase 4 — Align dates (timezone)

- **`subscriptions.expiry_date`** must be **`YYYY-MM-DD`** in the **gym timezone** (see `app_settings.timezone` / gym settings).
- The cron compares **today’s date in that timezone** to **`expiry_date`**.
- After migration, fix any member whose **next charge date** in Stripe doesn’t match **`expiry_date`** in app — otherwise renewal runs on the **wrong** calendar day.

---

## Phase 5 — Verification before go-live

### Per member who should auto-renew

| Step | Pass? |
|------|--------|
| `members.stripe_customer_id` = `cus_...` | ☐ |
| Stripe customer has a **card** payment method | ☐ |
| **`subscriptions`**: one **Active** row, **`product_id`** matches a **monthly** `membership_plans` row | ☐ |
| `expiry_date` = next renewal date you want (gym TZ) | ☐ |
| `members.auto_renew = 1` | ☐ |
| Waiver / Kisi rules satisfied if you grant door access on renewal (see `KISI.md`) | ☐ |

### Spot-check the cron (staging or production)

- Call **`GET /api/cron/renew-subscriptions`** with **`Authorization: Bearer $CRON_SECRET`** (or `x-cron-secret`) on a **test** day, or temporarily use a test member whose **`expiry_date`** is **today**.
- Read JSON **`details`**: look for `renewed` vs `skipped` (`Auto-renew not opted in`, `No saved card`, etc.).

---

## Phase 6 — What the Glofox import **did** do

- Updates **name, phone, join_date, `exp_next_payment_date`** from CSV.
- Does **not** set Stripe ids, `subscriptions`, or `auto_renew`.

Treat **`exp_next_payment_date`** as **informational** until **`subscriptions`** + Stripe are aligned.

---

## Quick reference: who is “set up” for auto-renew?

**Fully set up** = all of:

1. `stripe_customer_id`  
2. Card on Stripe customer  
3. Active monthly **`subscriptions`** row with correct **`expiry_date`**  
4. **`auto_renew` = 1**

**Not sufficient alone:** only (4), or only Stripe migration without (3).

---

## Support docs

- Door access + Kisi: **`KISI.md`** (root).
- Stripe webhooks (if you extend): **`docs/STRIPE_WEBHOOK.md`**.

---

## Onboarding CSV (bulk import)

**Templates on this screen:** On **Onboarding docs** (admin sidebar), use the **CSV templates** box to download the minimal, full, and example files (same as `docs/onboarding-import-*.csv` and `/onboarding-import-*.csv` in the app).

Run **Import members (Glofox CSV)** first so each row has `email`, name, `join_date`, `phone`, and `exp_next_payment_date`. Then use **Import onboarding (CSV)** with a short second file.

### Recommended: minimal columns

| Column | Purpose |
|--------|---------|
| `email` | **Required.** Must match an existing member (from Glofox import). |
| `auto_renew` | Optional. `1` / `0`, or `yes` / `no`. |
| `stripe_customer_id` | Optional. `cus_…` after Stripe migration. |
| `membership_plan_name` | **Required** for a subscription row — must match **`membership_plans.plan_name`** exactly (same spelling as **Membership plans** in the app). The app resolves **`product_id`** and plan price. |
| `subscription_quantity` | Optional; default `1`. |
| `subscription_price` | Optional. Overrides stored subscription price (e.g. legacy $69 while catalog is $89). **Renewals still use catalog price** unless you also set `renewal_price_indefinite` or `renewal_discount_months`. |
| `renewal_price_indefinite` | Optional. `1` / `true` / `yes` — monthly renewals charge **`subscription_price`** until you change it (same as staff cart “indefinite” override). Omit if everyone should renew at catalog price. |
| `renewal_discount_months` | Optional. Integer *N* — *N* months total at **`subscription_price`**, then price resets to catalog (same math as staff cart “months” override). Do not use together with `renewal_price_indefinite`. |
| `notes` | Ignored. |

**Subscription dates:** The import uses the member’s **`exp_next_payment_date`** (from Glofox) as **`subscription_expiry_date`**, unless you override with `subscription_expiry_date` or `exp_next_payment_date` on this row. **Start date** is derived by stepping back one billing period from that expiry using the plan’s **length** and **unit** (same rules as checkout).

If two plans share the same name, rename one in **Membership plans** or use full mode below.

### Full mode (optional)

Use **`membership_product_id`** + **`subscription_expiry_date`** when you want explicit IDs and dates. Do **not** put **`membership_plan_name`** and **`membership_product_id`** on the same row. See `docs/onboarding-import-full-template.csv`.

| Column | Purpose |
|--------|---------|
| `email` | **Required.** Match key; can create member if missing. |
| `first_name`, `last_name`, `phone`, `join_date`, `exp_next_payment_date` | Optional on update; merged with existing member when blank. |
| `stripe_customer_id`, `auto_renew` | Optional. |
| `membership_product_id` | Must match **`membership_plans.product_id`**. |
| `subscription_start_date` | Optional; defaults to `join_date` or today. |
| `subscription_expiry_date` | Required with `membership_product_id`. |
| `subscription_quantity`, `subscription_price` | Optional. |
| `renewal_price_indefinite`, `renewal_discount_months` | Optional. Same meaning as minimal mode — use with `subscription_price` for legacy/discount renewals vs catalog. |

**Templates:** `docs/onboarding-import-template.csv` (minimal), `docs/onboarding-import-full-template.csv` (full), `public/onboarding-import-example.csv` (example). Download from **Onboarding docs** in the admin sidebar, then use the **Import onboarding CSV** link on that page.

**Admin:** **Import onboarding (CSV)** (`/admin/import-onboarding`) — open from **Onboarding docs**. Paste or upload the CSV. Existing members are updated by email; Active subscriptions for that `product_id` are updated or inserted.
