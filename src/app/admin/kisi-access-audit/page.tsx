"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { KISI_AUDIT_BATCH_SIZE } from "@/lib/kisi-audit-config";

type AuditRow = {
  member_id: string;
  email: string | null;
  name: string | null;
  kisi_id: string | null;
  app_has_door_access_today: boolean;
  active_membership_in_app?: boolean;
  app_valid_until_iso: string | null;
  waiver_signed: boolean;
  open_payment_failures: number;
  subscription_summary: string;
  kisi_has_active_role: boolean;
  kisi_valid_until_iso: string | null;
  sync_status: string;
  likely_causes: string[];
};

type AuditResponse = {
  today_ymd?: string;
  timezone?: string;
  audited_at?: string;
  kisi_configured?: boolean;
  members_scanned?: number;
  in_sync?: number;
  mismatches?: AuditRow[];
  rows?: AuditRow[];
  members_in_scope?: number;
  scope?: string;
  pagination?: {
    offset: number;
    limit: number;
    members_in_scope: number;
    members_with_email_total?: number;
    has_more: boolean;
    next_offset: number | null;
  };
  mismatch_by_status?: Record<string, number>;
};

const STATUS_LABEL: Record<string, string> = {
  in_sync: "In sync",
  missing_kisi_user: "No Kisi user",
  missing_role: "No Kisi role",
  expired_role: "Kisi role expired",
  waiver_blocked: "Waiver missing",
  no_email: "No email",
  app_no_access_has_kisi: "Kisi active, app says no access",
  pass_not_activated: "Pass not activated today",
  kisi_api_error: "Kisi API unreachable (retry audit)",
};

export default function KisiAccessAuditPage() {
  const [loading, setLoading] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const limit = KISI_AUDIT_BATCH_SIZE;

  const runAudit = useCallback(async (nextOffset = 0) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/kisi-access-audit?mismatches_only=1&limit=${limit}&offset=${nextOffset}`
      );
      const json = (await res.json()) as AuditResponse & { error?: string };
      if (!res.ok) {
        setMessage({ type: "err", text: json.error ?? "Audit failed" });
        return;
      }
      setData(json);
      setOffset(nextOffset);
    } catch {
      setMessage({
        type: "err",
        text: "Audit request failed (timeout or server restart). Wait for Railway deploy to finish, then try again.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  async function fixBatch() {
    setFixLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/kisi-access-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fix_all_mismatches: true, offset, limit }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: json.error ?? "Fix failed" });
        return;
      }
      setMessage({
        type: "ok",
        text: `Fixed ${json.fixed_count ?? 0}, skipped ${json.skipped_count ?? 0}, errors ${json.error_count ?? 0}.`,
      });
      await runAudit(offset);
    } catch {
      setMessage({ type: "err", text: "Fix request failed." });
    } finally {
      setFixLoading(false);
    }
  }

  async function fixOne(memberId: string) {
    setFixLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/kisi-access-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: [memberId] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: json.error ?? json.skipped?.[0]?.reason ?? "Fix failed" });
        return;
      }
      setMessage({ type: "ok", text: `Fixed ${memberId}.` });
      await runAudit(offset);
    } catch {
      setMessage({ type: "err", text: "Fix request failed." });
    } finally {
      setFixLoading(false);
    }
  }

  const rows = data?.rows ?? data?.mismatches ?? [];

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Admin settings
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Kisi access audit</h1>
        <p className="text-stone-600 mt-2 max-w-3xl">
          We build the list from <strong className="font-medium text-stone-800">Active memberships in the app</strong>{" "}
          (paid, not expired, not paused — not your old inactive imports). Then we check each person against Kisi. We
          never use Kisi to decide who is on the list.
        </p>
        <p className="text-stone-500 text-sm mt-2 max-w-3xl">
          A full scan runs automatically at <strong className="font-medium">3:00 AM gym time</strong> in batches of{" "}
          {KISI_AUDIT_BATCH_SIZE} (emails staff if mismatches are found). Use this page for manual checks{" "}
          <strong className="font-medium">off-hours only</strong> — one batch at a time.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          onClick={() => runAudit(0)}
          disabled={loading}
          className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Run audit (mismatches only)"}
        </button>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={fixBatch}
            disabled={fixLoading || loading}
            className="px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            {fixLoading ? "Fixing…" : "Fix this batch (re-grant Kisi)"}
          </button>
        )}
        {data?.pagination?.has_more && (
          <button
            type="button"
            onClick={() => runAudit(data.pagination!.next_offset ?? offset + limit)}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            Next batch
          </button>
        )}
      </div>

      {message && (
        <p
          className={`mb-4 text-sm rounded-lg px-3 py-2 ${
            message.type === "ok" ? "bg-brand-50 text-stone-800 border border-brand-100" : "bg-red-50 text-red-800 border border-red-100"
          }`}
        >
          {message.text}
        </p>
      )}

      {data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-stone-500">Today ({data.timezone})</div>
            <div className="font-semibold text-stone-800">{data.today_ymd}</div>
            {data.audited_at && (
              <div className="text-xs text-stone-400 mt-1">
                Live snapshot: {new Date(data.audited_at).toLocaleString()}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-stone-500">Active in app (audit list)</div>
            <div className="font-semibold text-stone-800">
              {data.members_in_scope ?? data.pagination?.members_in_scope ?? "—"} in scope
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-stone-500">Scanned / in sync</div>
            <div className="font-semibold text-stone-800">
              {data.members_scanned} / {data.in_sync} OK
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-stone-500">Kisi configured</div>
            <div className="font-semibold text-stone-800">{data.kisi_configured ? "Yes" : "No — check env"}</div>
          </div>
        </div>
      )}

      {data?.mismatch_by_status && Object.keys(data.mismatch_by_status).length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {Object.entries(data.mismatch_by_status).map(([status, count]) => (
            <span key={status} className="text-xs rounded-full bg-stone-100 border border-stone-200 px-3 py-1 text-stone-700">
              {STATUS_LABEL[status] ?? status}: {count}
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 && data && !loading && (
        <p className="text-stone-600 text-sm">No mismatches in this batch — nice!</p>
      )}

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.member_id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/members/${encodeURIComponent(r.member_id)}`} className="font-semibold text-brand-700 hover:underline">
                  {r.name ?? r.member_id}
                </Link>
                <div className="text-sm text-stone-500">{r.email ?? "no email"}</div>
                <div className="text-sm text-stone-600 mt-1">{r.subscription_summary}</div>
              </div>
              <span className="text-xs font-medium rounded-full px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200">
                {STATUS_LABEL[r.sync_status] ?? r.sync_status}
              </span>
            </div>
            <dl className="mt-3 grid gap-1 text-sm text-stone-700 sm:grid-cols-2">
              <div>
                Active membership in app:{" "}
                <strong>{(r.active_membership_in_app ?? r.app_has_door_access_today) ? "Yes" : "No"}</strong>
              </div>
              <div>
                Kisi role (live API): <strong>{r.kisi_has_active_role ? "Yes" : "No"}</strong>
              </div>
              <div>Waiver signed: {r.waiver_signed ? "Yes" : "No"}</div>
              <div>Open payment failures: {r.open_payment_failures}</div>
              <div className="sm:col-span-2">kisi_id: {r.kisi_id ?? "—"}</div>
            </dl>
            {r.likely_causes.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-stone-600 space-y-1">
                {r.likely_causes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {["missing_kisi_user", "missing_role", "expired_role"].includes(r.sync_status) && (
              <button
                type="button"
                onClick={() => fixOne(r.member_id)}
                disabled={fixLoading}
                className="mt-3 text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
              >
                Fix this member
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
