/** Members checked per audit batch (in-app manual run and 3 AM cron). */
export const KISI_AUDIT_BATCH_SIZE = 25;

/** Pause between batches during the nightly cron (ms). */
export const KISI_AUDIT_BATCH_PAUSE_MS = 2000;

export const KISI_AUDIT_CRON_LAST_RUN_KEY = "kisi_audit_cron_last_ymd";
