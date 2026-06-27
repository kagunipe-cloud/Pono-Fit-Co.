import type { getDb } from "./db";
import { ensureMembersAutoRenewColumn } from "./db";

type AppDb = ReturnType<typeof getDb>;

export type AutoRenewChangeSource =
  | "admin"
  | "member"
  | "checkout"
  | "reactivate"
  | "import"
  | "account_deletion";

export function ensureAutoRenewEventsTable(db: AppDb) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auto_renew_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        previous_enabled INTEGER,
        changed_at TEXT NOT NULL,
        changed_by_member_id TEXT,
        source TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auto_renew_events_changed_at ON auto_renew_events(changed_at);
      CREATE INDEX IF NOT EXISTS idx_auto_renew_events_member_id ON auto_renew_events(member_id);
    `);
  } catch (err) {
    console.error("[auto-renew-events] ensureAutoRenewEventsTable", err);
  }
}

export function recordAutoRenewChange(
  db: AppDb,
  opts: {
    memberId: string;
    enabled: boolean;
    previousEnabled?: number | null;
    changedByMemberId?: string | null;
    source: AutoRenewChangeSource;
    changedAt?: string;
  }
) {
  ensureAutoRenewEventsTable(db);
  const changedAt = opts.changedAt ?? new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `INSERT INTO auto_renew_events (member_id, enabled, previous_enabled, changed_at, changed_by_member_id, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    opts.memberId,
    opts.enabled ? 1 : 0,
    opts.previousEnabled ?? null,
    changedAt,
    opts.changedByMemberId?.trim() || null,
    opts.source
  );
}

/** Updates members.auto_renew and logs when the value actually changes. */
export function setMemberAutoRenew(
  db: AppDb,
  opts: {
    memberId: string;
    enabled: boolean;
    changedByMemberId?: string | null;
    source: AutoRenewChangeSource;
  }
): { changed: boolean; autoRenew: number } {
  ensureMembersAutoRenewColumn(db);
  ensureAutoRenewEventsTable(db);

  const row = db
    .prepare("SELECT auto_renew FROM members WHERE member_id = ?")
    .get(opts.memberId) as { auto_renew: number | null } | undefined;
  if (!row) {
    throw new Error("Member not found");
  }

  const next = opts.enabled ? 1 : 0;
  const prev = row.auto_renew ?? 0;
  if (prev === next) {
    return { changed: false, autoRenew: next };
  }

  db.prepare("UPDATE members SET auto_renew = ? WHERE member_id = ?").run(next, opts.memberId);
  recordAutoRenewChange(db, {
    memberId: opts.memberId,
    enabled: opts.enabled,
    previousEnabled: prev,
    changedByMemberId: opts.changedByMemberId ?? null,
    source: opts.source,
  });

  return { changed: true, autoRenew: next };
}

export const AUTO_RENEW_SOURCE_LABELS: Record<AutoRenewChangeSource, string> = {
  admin: "Admin",
  member: "Member",
  checkout: "Checkout",
  reactivate: "Reactivate",
  import: "Import",
  account_deletion: "Account deletion",
};
