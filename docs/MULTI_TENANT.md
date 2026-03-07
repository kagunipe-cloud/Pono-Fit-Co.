# Multi-tenant / Stripe Connect readiness

The schema is set up so adding Stripe Connect or licensing to other gyms is straightforward.

## What's in place

### 1. `gyms` table

Stores per-gym config:

| Column | Purpose |
|--------|---------|
| `name`, `short_name` | Display name |
| `logo_url` | Custom logo (null = use default) |
| `theme_color`, `primary_color` | Brand colors |
| `waiver_pdf_url`, `waiver_text` | Custom waiver |
| `features` | JSON: `{"rec_leagues": true, "macros": true, ...}` — enable/disable features per gym |
| `stripe_connect_account_id` | For Stripe Connect; null until gym onboarded |
| `timezone` | Per-gym timezone |

Default gym (id=1) is seeded with Pono Fit values.

### 2. `gym_id` on data tables

These tables have `gym_id INTEGER DEFAULT 1`:

- `members`, `subscriptions`, `membership_plans`, `sales`
- `payment_failures`, `trainers`
- `pt_sessions`, `classes`, `recurring_classes`
- `cart`, `cart_items`
- `door_access_events`, `app_usage_events`
- `sales`, `pt_bookings`, `class_bookings` (when they exist)

Existing rows get `gym_id = 1` via DEFAULT. New inserts can pass `gym_id` explicitly.

### 3. Branding API

`GET /api/branding?gym_id=1` returns `{ name, shortName, logoUrl, themeColor, primaryColor }`.

For now, client components use `brand-colors.json`. When you add gym 2+, have the layout fetch `/api/branding` and pass branding down, or use the logo from `logo_url`.

### 4. Feature flags

`gyms.features` is JSON. Use `isFeatureEnabled(gym, "rec_leagues")` etc. to hide Rec Leagues, Macros, AI Calculate, etc. per gym.

### 5. Waivers

- `gyms.waiver_pdf_url` — custom PDF per gym
- `gyms.waiver_text` — custom waiver text (e.g. for rec leagues)

The sign-waiver flow uses `/waiver.pdf` by default; you can switch to `gym.waiver_pdf_url` when set.

## When adding another gym

### Copy & license (separate deployment)

1. Deploy a new instance.
2. Set env vars (Stripe, Kisi, etc.) for that gym.
3. Run DB migrations (or start fresh).
4. Update `brand-colors.json` and `gyms` row 1 for that gym’s branding.
5. Optionally add an admin UI to edit `gyms` for logo, waiver, features.

### Stripe Connect (single platform)

1. Add a row to `gyms` (name, logo, etc.).
2. Run Stripe Connect onboarding for that gym.
3. Store `stripe_connect_account_id` in `gyms`.
4. Update checkout/cron to use `stripe.accounts` and create payments on the connected account.
5. Add tenant context (subdomain, session, or URL param) so `getCurrentGymId()` returns the right gym.
6. Filter all queries by `gym_id`.

## Tenant context

Right now everything uses `gym_id = 1`. To support multiple gyms in one app:

- **Subdomain**: `gym1.yourapp.com` → gym 1
- **Session**: Store `gym_id` in the session after login.
- **URL**: `/g/2/member` or `?gym_id=2` for gym 2.

Add `getCurrentGymId(request)` that reads from one of these and returns the gym id. Use it in API routes and pass to DB queries.
