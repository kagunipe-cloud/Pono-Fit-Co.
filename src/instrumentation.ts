/**
 * Runs once when the Next.js Node.js server starts.
 * Schedules a daily subscription renewal job when the app is running as a
 * long-running process (e.g. `next start` on a VPS). Not used on Vercel/serverless
 * (no always-on process there — use Vercel Cron or an external cron instead).
 *
 * Daily jobs use the **gym timezone** from the DB (`getAppTimezone` — `gyms.timezone`
 * for gym 1, else `app_settings.timezone`), same as the rest of the app.
 *
 * If you see "missed execution" from node-cron: the main thread was busy at the
 * scheduled time (e.g. handling requests or cold start). For production, the most
 * reliable approach is to run cron externally (system cron or Vercel Cron) and
 * call the API with CRON_SECRET. We retry once after 2 minutes for the daily job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL === "1") return;

  const cron = await import("node-cron");
  const { getDb, getAppTimezone } = await import("@/lib/db");
  const port = process.env.PORT || "3000";
  const base = `http://127.0.0.1:${port}`;
  const secret = process.env.CRON_SECRET ?? "";

  let gymTzOpts: { timezone: string };
  try {
    const db = getDb();
    const tz = getAppTimezone(db, 1);
    db.close();
    gymTzOpts = { timezone: tz };
  } catch (e) {
    console.error("[instrumentation] Failed to read gym timezone; using Pacific/Honolulu", e);
    gymTzOpts = { timezone: "Pacific/Honolulu" };
  }

  const runRenewal = async () => {
    try {
      const res = await fetch(`${base}/api/cron/renew-subscriptions`, {
        headers: secret ? { "x-cron-secret": secret } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[renew-subscriptions]", res.status, data);
        return false;
      }
      if ((data.renewed as number) > 0 || (data.errors as number) > 0) {
        console.log("[renew-subscriptions]", data);
      }
      return true;
    } catch (err) {
      console.error("[renew-subscriptions]", err);
      return false;
    }
  };

  /** 2:00 / 2:10 AM in the configured gym timezone (not the host’s default UTC). */
  cron.schedule(
    "0 2 * * *",
    async () => {
      const ok = await runRenewal();
      if (!ok) {
        setTimeout(async () => {
          console.log("[renew-subscriptions] Retrying after missed window…");
          await runRenewal();
        }, 2 * 60 * 1000);
      }
    },
    gymTzOpts
  );

  cron.schedule("10 2 * * *", async () => {
    try {
      const res = await fetch(`${base}/api/cron/membership-expiry-reminders`, {
        headers: secret ? { "x-cron-secret": secret } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[membership-expiry-reminders]", res.status, data);
        return;
      }
      if ((data.sent as number) > 0) {
        console.log("[membership-expiry-reminders]", data.sent, "reminders sent");
      }
    } catch (err) {
      console.error("[membership-expiry-reminders]", err);
    }
  }, gymTzOpts);

  cron.schedule("0 * * * *", async () => {
    try {
      const res = await fetch(`${base}/api/cron/process-pt-sessions`, {
        headers: secret ? { "x-cron-secret": secret } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[process-pt-sessions]", res.status, data);
        return;
      }
      if ((data.processed as number) > 0) {
        console.log("[process-pt-sessions]", data);
      }
    } catch (err) {
      console.error("[process-pt-sessions]", err);
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    try {
      await fetch(`${base}/api/cron/occupancy-snapshot`, {
        headers: secret ? { "x-cron-secret": secret } : {},
      });
    } catch (err) {
      console.error("[occupancy-snapshot]", err);
    }
  });

  const tzLabel = gymTzOpts.timezone;
  console.log(
    `[instrumentation] Daily renewal (2:00 AM ${tzLabel}), expiry reminders (2:10 AM ${tzLabel}); hourly PT; occupancy snapshot every 15 min.`
  );
}
