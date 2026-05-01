# Coconut Count (Occupancy)

The app tracks how many people are in the gym and records snapshots for analytics.

## How it works

1. **Live count** (Coconut Count widget): Entries in `occupancy_entries` within the last hour. Each entry = +1. Entries auto-expire after 1 hour.
2. **Snapshots** (analytics charts): Every 15 minutes, a cron job records the current count into `occupancy_snapshots`. Charts use this data.

## Sources of +1

- **App unlock** (Unlock button, /unlock page): When someone unlocks via the app, we add +1 immediately. Works even if Kisi webhook is not configured.
- **Kisi webhook** (physical card tap, Kisi app): When Kisi sends a `lock.unlock` webhook, we add an entry. See **KISI.md** → "Unlock tracking (webhook)". Configure in Kisi: Integrations → Event Webhook → `lock.unlock` → `https://your-domain.com/api/kisi/webhook`.
- **Manual +1**: Admin uses the Coconut Count widget to add walk-ins (e.g. door propped open).

## Why you might see no data

### 1. Cron not running (Vercel)

On Vercel, the in-process cron in **`src/instrumentation.ts`** does not run (`VERCEL=1`). Use **Vercel Cron** instead:

- This repo’s **`vercel.json`** schedules **`/api/cron/occupancy-snapshot`** (and renewal / reminders / PT jobs). Deploy and those routes are invoked on the schedule.
- Set **`CRON_SECRET`** in Vercel env (recommended). Cron invocations include **`Authorization: Bearer <CRON_SECRET>`** when that variable is set; our handlers also accept **`x-cron-secret`** for manual calls.
- **Note**: Vercel cron runs in **UTC**. Adjust schedules if needed for your timezone (see **`CRON-RENEWALS.md`** for renewal times vs Honolulu).

### 2. Kisi webhook not configured or failing

For door unlocks to add to occupancy:

1. In Kisi: **Integrations** → **Event Webhook** → event type `lock.unlock` → URL `https://your-domain.com/api/kisi/webhook`
2. If you set `KISI_WEBHOOK_SECRET`, the signature key in Kisi must match exactly. Wrong key = 401, no processing.
3. Check Kisi webhook logs for delivery errors (404, 401, 500).

### 3. No data before today

Snapshots only exist from when the cron started running. Historical door unlocks are in `door_access_events` but are not backfilled into `occupancy_snapshots`.
