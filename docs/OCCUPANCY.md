# Coconut Count (Occupancy)

The app tracks how many people are in the gym and records snapshots for analytics.

## How it works

1. **Live count** (Coconut Count widget): Entries in `occupancy_entries` within the last hour. Each entry = +1. Entries auto-expire after 1 hour.
2. **Snapshots** (analytics charts): Every 15 minutes, a cron job records the current count into `occupancy_snapshots`. Charts use this data.

## Sources of +1

- **Kisi door unlock**: When Kisi sends a `lock.unlock` webhook, we add an entry. See **KISI.md** → "Unlock tracking (webhook)".
- **Manual +1**: Admin uses the Coconut Count widget to add walk-ins (e.g. door propped open).

## Why you might see no data

### 1. Cron not running (Vercel)

On Vercel, the in-process cron (instrumentation) is disabled. Use **Vercel Cron** instead:

- `vercel.json` includes cron jobs. Deploy and they run automatically.
- Set `CRON_SECRET` in Vercel env (recommended). Vercel sends it in the `Authorization` header.
- **Note**: Vercel cron runs in **UTC**. Adjust schedules if needed for your timezone.

### 2. Kisi webhook not configured or failing

For door unlocks to add to occupancy:

1. In Kisi: **Integrations** → **Event Webhook** → event type `lock.unlock` → URL `https://your-domain.com/api/kisi/webhook`
2. If you set `KISI_WEBHOOK_SECRET`, the signature key in Kisi must match exactly. Wrong key = 401, no processing.
3. Check Kisi webhook logs for delivery errors (404, 401, 500).

### 3. No data before today

Snapshots only exist from when the cron started running. Historical door unlocks are in `door_access_events` but are not backfilled into `occupancy_snapshots`.
