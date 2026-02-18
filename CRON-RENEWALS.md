# Subscription renewals (auto-charge)

The app can auto-charge members whose subscription expires **today** if they chose "Yes — save for renewals" at checkout.

## Option A: In-app scheduler (easiest if you run your own server)

If you run the app with **`next start`** (e.g. on a VPS, Docker, or a long-running Node server), a **daily renewal job is already built in**. It runs at **2:00 AM server time** and calls the renewal endpoint for you.

- **No extra setup** — just keep the app running.
- **Not used on Vercel** — Vercel runs your app in short-lived serverless functions, so there’s no always-on process. Use Option B there.

(Optional) To protect the endpoint when using the in-app scheduler, set in `.env.local`:

```bash
CRON_SECRET=your-random-secret-string
```

The in-app job will send this when calling the endpoint.

---

## Option B: External trigger (for Vercel or any host)

If you’re on **Vercel** or prefer an external cron, something needs to **call** the renewal URL once per day:

- **Vercel Cron**: add a cron in `vercel.json` that hits `GET https://your-app.com/api/cron/renew-subscriptions` (and send `x-cron-secret` if you set `CRON_SECRET`).
- **cron-job.org** (or similar): create a daily job that does the same `GET` with the optional header.
- **Server crontab**: e.g. `0 2 * * * curl -H "x-cron-secret: YOUR_SECRET" https://your-app.com/api/cron/renew-subscriptions`.

---

## What the endpoint does

- Finds all **Active** subscriptions whose **expiry_date** is **today** and whose plan is a **monthly** membership (`unit = 'Month'`). Yearly or other plan types are not auto-renewed.
- For each, if the member has a saved card (`stripe_customer_id`), charges that card and creates the next subscription period.
- Returns JSON with counts (renewed, skipped, errors) and per-member details.
