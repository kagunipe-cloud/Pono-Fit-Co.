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

All tenant-scoped tables have `gym_id INTEGER DEFAULT 1`:

**Core:** `members`, `subscriptions`, `membership_plans`, `sales`, `payment_failures`, `trainers`, `cart`, `cart_items`, `door_access_events`, `app_usage_events`

**PT:** `pt_sessions`, `pt_bookings`, `trainer_availability`, `pt_trainer_specific_bookings`, `pt_slot_bookings`, `pt_credit_ledger`, `pt_pack_products`, `pt_open_bookings`, `unavailable_blocks`

**Classes:** `classes`, `recurring_classes`, `class_bookings`, `class_occurrences`, `class_pack_products`, `class_credit_ledger`, `occurrence_bookings`

**Rec leagues:** `rec_leagues`, `rec_teams`, `rec_team_league_enrollments`, `rec_team_members`, `rec_team_invites`, `rec_games`, `rec_waiver_tokens`, `rec_playoff_brackets`

Indexes on `gym_id` exist for high-traffic tables (members, subscriptions, sales, cart, pt_sessions, classes, trainers).

### 3. Tenant context (`src/lib/tenant.ts`)

- `getCurrentGymId(request)` — returns gym id from `?gym_id=`, `X-Gym-Id` header, or default
- `gymWhere(alias, gymId)` — use in queries: `WHERE ${gymWhere("m", gymId)} AND ...`
- `gymWhereParams(gymId)` — params for prepared statements

Use in API routes: `const gymId = await getCurrentGymId(request);` then filter queries by `gym_id`.

### 4. Branding API

`GET /api/branding?gym_id=1` returns `{ name, shortName, logoUrl, themeColor, primaryColor }`.

For now, client components use `brand-colors.json`. When you add gym 2+, have the layout fetch `/api/branding` and pass branding down, or use the logo from `logo_url`.

### 5. Feature flags

`gyms.features` is JSON. Use `isFeatureEnabled(gym, "rec_leagues")` etc. to hide Rec Leagues, Macros, AI Calculate, etc. per gym.

### 6. Waivers

- `gyms.waiver_pdf_url` — custom PDF per gym
- `gyms.waiver_text` — custom waiver text (e.g. for rec leagues)

The sign-waiver flow uses `/waiver.pdf` by default; you can switch to `gym.waiver_pdf_url` when set.

## When migrating to PostgreSQL

### Connection pooling

SQLite uses a single file and doesn't need connection pooling. **Postgres does.** When you migrate:

- **Neon / Supabase** — built-in pooling (PgBouncer). Use the pooled connection string (often `-pooler` in the host).
- **Railway Postgres** — add PgBouncer as a service or use a pool in-app (e.g. `pg` with `max: 10`).
- **Raw pg** — `new Pool({ max: 20, connectionTimeoutMillis: 5000 })` and reuse the pool.

Avoid opening a new connection per request. Use one pool per process.

### Row-Level Security (RLS)

Postgres RLS enforces tenant isolation at the database level. After migration:

1. Enable RLS on tenant-scoped tables: `ALTER TABLE members ENABLE ROW LEVEL SECURITY;`
2. Create a policy: `CREATE POLICY tenant_isolation ON members USING (gym_id = current_setting('app.gym_id', true)::int OR gym_id IS NULL);`
3. Set context per request: `SELECT set_config('app.gym_id', '1', true);` at the start of each request.

This prevents accidental cross-tenant data leaks even if application code forgets a `WHERE gym_id = ?`.

### Avoiding N+1 queries

When listing members with subscriptions, etc., use JOINs or batch queries instead of looping:

```sql
-- Good: single query with JOIN
SELECT m.*, s.expiry_date FROM members m LEFT JOIN subscriptions s ON s.member_id = m.member_id AND s.status = 'Active' WHERE m.gym_id = ?

-- Bad: N+1 — one query for members, then one per member for subscriptions
```

## When adding another gym (single deployment)

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

Right now everything uses `gym_id = 1`. To support multiple gyms in one app, extend `getCurrentGymId()` to read from:

- **Subdomain**: `gym1.yourapp.com` → gym 1
- **Session**: Store `gym_id` in the session after login
- **URL**: `/g/2/member` or `?gym_id=2` for gym 2
