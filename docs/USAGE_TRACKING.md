# Usage tracking

The app records two kinds of usage for reporting and product decisions.

## 1. Door access (gym usage)

When a member unlocks a door and Kisi is configured to send webhooks to this app, each unlock is stored in **door_access_events**.

- **Setup**: Configure a Kisi Event Webhook for `lock.unlock` pointing at `https://<your-domain>/api/kisi/webhook`. See **KISI.md** for steps.
- **Optional**: Set `KISI_WEBHOOK_SECRET` in env and the same value as the webhook’s “Signature key” in Kisi so the app verifies requests.
- **Tables**: `door_access_events` — `uuid` (idempotency), `member_id` (if we can match Kisi user to member), `kisi_actor_id`, `lock_id`, `lock_name`, `success`, `happened_at`, `created_at`.

Unlocks by a **User** in Kisi are linked to your member when `members.kisi_id` matches the event’s `actor_id`. Unlocks via access link or request-to-exit may have no `actor_id`; those rows have `member_id` null but still record time and lock.

## 2. App usage

When a member uses the member area, the app records **page views** (and optionally other events).

- **Automatic**: Under `/member/*`, the layout sends a `page_view` event to `POST /api/usage` with the current path. Same path is not re-sent within 30 seconds.
- **Manual**: You can send other events from the client: `POST /api/usage` with `{ "event_type": "custom_name", "path": "/optional/path" }`. Requires member session.
- **Tables**: `app_usage_events` — `member_id`, `event_type`, `path`, `created_at`.

## Data volume and cost

- **Door**: One row per unlock; a few hundred bytes per row. Thousands of unlocks per month = negligible storage.
- **App**: One row per tracked action (e.g. page view per 30s per path). Tens of thousands of events per month = still small (single-digit MB).

Both tables are created automatically on first use (see `src/lib/usage.ts`). Query them from your own reports, admin views, or exports.
