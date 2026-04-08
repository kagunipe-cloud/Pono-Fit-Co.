# Subscription renewals (auto-charge)

The app can auto-charge members whose subscription expires **today** if they chose "Yes — save for renewals" at checkout.

## Option A: In-app scheduler (easiest if you run your own server)

If you run the app with **`next start`** (e.g. on Railway, Docker, or a long-running Node server), a **daily renewal job is already built in**. It runs at **2:00 AM** in the **gym timezone from the database** (`getAppTimezone`: `gyms.timezone` for gym `id = 1`, else `app_settings.timezone`) via `node-cron` in `instrumentation.ts`, with **expiry reminders at 2:10 AM** in that same zone. That matches schedules, renewals, and “today” everywhere else in the app.

**Multi-gym later:** one process currently uses **gym 1** for the clock. True per-gym overnight jobs would need separate schedulers or workers per tenant.

- **No extra setup** — just keep the app running.
- **Not used on Vercel** — Vercel runs your app in short-lived serverless functions, so there’s no always-on process. Use Option B there.

(Optional) To protect the endpoint, set in `.env.local` / Railway variables:

```bash
CRON_SECRET=your-random-secret-string
```

The in-app job will send this when calling the endpoint. **If `CRON_SECRET` is unset**, the renewal URL is **open** (anyone who can `GET` it can trigger a run) — fine for quick manual tests, but **set a secret in production** and call with `Authorization: Bearer …` or header `x-cron-secret: …`.

### Run renewals manually (right now)

- **Browser:** open `https://your-domain/api/cron/renew-subscriptions` (logged-in not required).
- **curl:** `curl -sS "https://your-domain/api/cron/renew-subscriptions"` — add `-H "x-cron-secret: YOUR_SECRET"` if you use `CRON_SECRET`.

### Vercel Cron (`vercel.json`)

**Proactive template** if you ever move off Railway: Vercel can’t read your SQLite at build time, so `vercel.json` uses **fixed UTC** schedules. **`0 12 * * *`** / **`10 12 * * *`** = 2:00 / 2:10 AM **only when** your primary gym timezone is **Pacific/Honolulu** (HST = UTC−10 → 2 AM HST = 12:00 UTC). If the gym uses another IANA zone, recompute the UTC hour/minute for “2 AM local” and update `vercel.json`, or trigger renewal from an external cron that calls the HTTPS URL.

---

## Option B: External trigger (for Vercel or any host)

If you’re on **Vercel** or prefer an external cron, something needs to **call** the renewal URL once per day:

- **Vercel Cron**: add a cron in `vercel.json` that hits `GET https://your-app.com/api/cron/renew-subscriptions` (and send `x-cron-secret` if you set `CRON_SECRET`).
- **cron-job.org** (or similar): create a daily job that does the same `GET` with the optional header.
- **Server crontab**: e.g. `0 2 * * * curl -H "x-cron-secret: YOUR_SECRET" https://your-app.com/api/cron/renew-subscriptions`.

---

## What the endpoint does

- Finds all **Active** subscriptions whose **expiry_date** is **today** and whose plan is a **monthly** membership (`unit = 'Month'`). Yearly or other plan types are not auto-renewed.
- For each, if the member has a saved card (`stripe_customer_id`) **and** has opted in to auto-renew (`auto_renew = 1`), charges that card and creates the next subscription period.
- Members can opt in via: (1) "Save for renewals" at checkout, (2) the auto-renew toggle on **My Membership** (member portal), or (3) admin toggle on the member detail page.
- Returns JSON with counts (renewed, skipped, errors) and per-member details.
