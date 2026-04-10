"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  createFetchTimeoutSignal,
  FETCH_TIMEOUT_WELCOME_EMAIL_MS,
  isFetchAbortError,
} from "@/lib/client-fetch-timeout";

type MemberWithEmail = { member_id: string; email: string; first_name: string | null; last_name: string | null };

export default function AdminEmailMembersPage() {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    total: number;
    failed: number;
    batches?: number;
    errors?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingIds, setSendingIds] = useState(false);
  const [idsResult, setIdsResult] = useState<{ sent: number; total: number; failed: number; errors?: string[] } | null>(null);
  const [welcomeMembers, setWelcomeMembers] = useState<MemberWithEmail[]>([]);
  const [loadingWelcomeMembers, setLoadingWelcomeMembers] = useState(false);
  /** When true, welcome list + sends only include active members (Active subscription) who still need app password and/or waiver. */
  const [welcomeOnboardingOnly, setWelcomeOnboardingOnly] = useState(true);
  const [welcomeSearch, setWelcomeSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendingSelected, setSendingSelected] = useState(false);
  const [selectedResult, setSelectedResult] = useState<{ sent: number; total: number; failed: number; errors?: string[] } | null>(null);
  const [waiverMemberId, setWaiverMemberId] = useState("");
  const [sendingWaiver, setSendingWaiver] = useState(false);
  const [waiverResult, setWaiverResult] = useState<{ message: string; url?: string } | null>(null);

  // Email Groups filters
  const [trialExpiredDays, setTrialExpiredDays] = useState<number | "">("");
  const [compProductType, setCompProductType] = useState<string>("");
  const [compProductId, setCompProductId] = useState<number | "">("");
  const [planStatus, setPlanStatus] = useState<string>("");
  const [joinDateInDays, setJoinDateInDays] = useState<number | "">("");
  const [minClassBookings, setMinClassBookings] = useState<number | "">("");
  const [minPtBookings, setMinPtBookings] = useState<number | "">("");
  const [minVisits, setMinVisits] = useState<number | "">("");
  const [visitsInDays, setVisitsInDays] = useState<number | "">("");
  const [isLead, setIsLead] = useState(false);
  const [failedPayment, setFailedPayment] = useState(false);
  const [failedPaymentDays, setFailedPaymentDays] = useState<number | "">("");
  const [failedPaymentPlanId, setFailedPaymentPlanId] = useState<number | "">("");
  const [filteredMembers, setFilteredMembers] = useState<{ member_ids: string[]; count: number } | null>(null);
  const [loadingFiltered, setLoadingFiltered] = useState(false);
  const [groupOptions, setGroupOptions] = useState<{
    plans?: { id: number; plan_name: string }[];
    sessions?: { id: number; session_name: string }[];
    classes?: { id: number; class_name: string }[];
    classPacks?: { id: number; name: string }[];
    ptPackProducts?: { id: number; name: string }[];
  } | null>(null);
  const [groupSubject, setGroupSubject] = useState("");
  const [groupText, setGroupText] = useState("");
  const [sendingGroup, setSendingGroup] = useState(false);
  const [groupResult, setGroupResult] = useState<{
    sent: number;
    total: number;
    failed: number;
    batches?: number;
    errors?: string[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/email-all-members")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { count?: number; smtp_configured?: boolean } | null) => {
        setRecipientCount(data?.count ?? 0);
        setSmtpConfigured(data?.smtp_configured ?? false);
      })
      .catch(() => {
        setRecipientCount(0);
        setSmtpConfigured(false);
      })
      .finally(() => setLoadingCount(false));
  }, []);

  useEffect(() => {
    if (!smtpConfigured) return;
    setLoadingWelcomeMembers(true);
    setSelectedIds(new Set());
    const q = welcomeOnboardingOnly ? "?filter=needs_password_or_waiver" : "";
    fetch(`/api/admin/email-member-ids${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members?: MemberWithEmail[] } | null) => {
        setWelcomeMembers(data?.members ?? []);
      })
      .catch(() => setWelcomeMembers([]))
      .finally(() => setLoadingWelcomeMembers(false));
  }, [smtpConfigured, welcomeOnboardingOnly]);

  // Load Email Groups filter options
  useEffect(() => {
    if (!smtpConfigured) return;
    fetch("/api/admin/email-groups/members?include_options=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setGroupOptions({
            plans: data.plans ?? [],
            sessions: data.sessions ?? [],
            classes: data.classes ?? [],
            classPacks: data.classPacks ?? [],
            ptPackProducts: data.ptPackProducts ?? [],
          });
        }
      })
      .catch(() => {});
  }, [smtpConfigured]);

  function fetchFilteredMembers() {
    setLoadingFiltered(true);
    const params = new URLSearchParams();
    if (trialExpiredDays !== "" && trialExpiredDays > 0) params.set("trial_complimentary_expired_days", String(trialExpiredDays));
    if (compProductType) params.set("complimentary_product_type", compProductType);
    if (compProductId !== "" && compProductId > 0) params.set("complimentary_product_id", String(compProductId));
    if (planStatus) params.set("plan_status", planStatus);
    if (joinDateInDays !== "" && joinDateInDays > 0) params.set("join_date_in_days", String(joinDateInDays));
    if (minClassBookings !== "" && minClassBookings > 0) params.set("min_class_bookings", String(minClassBookings));
    if (minPtBookings !== "" && minPtBookings > 0) params.set("min_pt_bookings", String(minPtBookings));
    if (minVisits !== "" && minVisits > 0) params.set("min_visits", String(minVisits));
    if (visitsInDays !== "" && visitsInDays > 0) params.set("visits_in_days", String(visitsInDays));
    if (isLead) params.set("is_lead", "1");
    if (failedPayment) params.set("failed_payment", "1");
    if (failedPaymentDays !== "" && failedPaymentDays > 0) params.set("failed_payment_days", String(failedPaymentDays));
    if (failedPaymentPlanId !== "" && failedPaymentPlanId > 0) params.set("failed_payment_plan_id", String(failedPaymentPlanId));
    fetch(`/api/admin/email-groups/members?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setFilteredMembers({ member_ids: data.member_ids ?? [], count: data.count ?? 0 });
        else setFilteredMembers(null);
      })
      .catch(() => setFilteredMembers(null))
      .finally(() => setLoadingFiltered(false));
  }

  async function handleSendToFilteredGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!filteredMembers || filteredMembers.count === 0) return;
    const sub = groupSubject.trim();
    const body = groupText.trim();
    if (!sub || !body) {
      setError("Subject and message are required.");
      return;
    }
    setError(null);
    setGroupResult(null);
    setSendingGroup(true);
    try {
      const res = await fetch("/api/admin/email-all-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: sub, text: body, member_ids: filteredMembers.member_ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      setGroupResult({
        sent: data.sent,
        total: data.total,
        failed: data.failed ?? 0,
        batches: data.batches,
        errors: data.errors,
      });
      setGroupSubject("");
      setGroupText("");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSendingGroup(false);
    }
  }

  const filteredWelcomeMembers = useMemo(() => {
    if (!welcomeSearch.trim()) return welcomeMembers;
    const q = welcomeSearch.trim().toLowerCase();
    return welcomeMembers.filter(
      (m) =>
        (m.first_name ?? "").toLowerCase().includes(q) ||
        (m.last_name ?? "").toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.member_id.toLowerCase().includes(q)
    );
  }, [welcomeMembers, welcomeSearch]);

  const selectAll = () => setSelectedIds(new Set(filteredWelcomeMembers.map((m) => m.member_id)));
  const deselectAll = () => setSelectedIds(new Set());
  const toggleOne = (member_id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(member_id)) next.delete(member_id);
      else next.add(member_id);
      return next;
    });
  };
  const selectedCount = selectedIds.size;
  const allFilteredSelected = filteredWelcomeMembers.length > 0 && selectedCount === filteredWelcomeMembers.length;
  const someFilteredSelected = selectedCount > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const sub = subject.trim();
    const body = text.trim();
    if (!sub || !body) {
      setError("Subject and message are required.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/email-all-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: sub, text: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      setResult({
        sent: data.sent,
        total: data.total,
        failed: data.failed ?? 0,
        batches: data.batches,
        errors: data.errors,
      });
      setSubject("");
      setText("");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendMemberIds() {
    setError(null);
    setIdsResult(null);
    setSendingIds(true);
    const { signal, clear } = createFetchTimeoutSignal(FETCH_TIMEOUT_WELCOME_EMAIL_MS);
    try {
      const res = await fetch("/api/admin/email-member-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: welcomeOnboardingOnly ? "needs_password_or_waiver" : "all",
        }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      setIdsResult({ sent: data.sent, total: data.total, failed: data.failed ?? 0, errors: data.errors });
    } catch (e) {
      if (isFetchAbortError(e)) {
        setError(
          "Request timed out after several minutes — some emails may have been sent. Check the server log or send in smaller batches."
        );
      } else {
        setError("Something went wrong.");
      }
    } finally {
      clear();
      setSendingIds(false);
    }
  }

  async function handleSendToSelected() {
    if (selectedCount === 0) return;
    setError(null);
    setSelectedResult(null);
    setSendingSelected(true);
    const { signal, clear } = createFetchTimeoutSignal(FETCH_TIMEOUT_WELCOME_EMAIL_MS);
    try {
      const res = await fetch("/api/admin/email-member-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_ids: Array.from(selectedIds),
          filter: welcomeOnboardingOnly ? "needs_password_or_waiver" : "all",
        }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send");
        return;
      }
      setSelectedResult({ sent: data.sent, total: data.total, failed: data.failed ?? 0, errors: data.errors });
      setSelectedIds(new Set());
    } catch (e) {
      if (isFetchAbortError(e)) {
        setError(
          "Request timed out after several minutes — some emails may have been sent. Check the server log or send in smaller batches."
        );
      } else {
        setError("Something went wrong.");
      }
    } finally {
      clear();
      setSendingSelected(false);
    }
  }

  async function handleSendWaiver() {
    const mid = waiverMemberId.trim();
    if (!mid) return;
    setWaiverResult(null);
    setSendingWaiver(true);
    try {
      const res = await fetch("/api/waiver/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: mid }),
      });
      const json = await res.json();
      if (res.ok) {
        setWaiverResult({ message: json.message, url: json.waiver_url });
      } else {
        setWaiverResult({ message: json.error ?? "Failed to send waiver." });
      }
    } catch {
      setWaiverResult({ message: "Failed to send waiver." });
    } finally {
      setSendingWaiver(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/members" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Members</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Email all members</h1>
      <p className="text-stone-500 text-sm mb-6">
        Broadcast the same subject and message to everyone using <strong>chunked BCC</strong> (one outbound message per batch, not one per person). <strong>All members with an email are included.</strong>{" "}
        <strong>Gmail API</strong> requires small BCC batches (default <strong>12</strong> addresses per send); set{" "}
        <code className="text-xs bg-stone-100 px-1 rounded">EMAIL_GMAIL_BCC_CHUNK</code> to tune.{" "}
        <strong>SMTP</strong> defaults to larger batches (env{" "}
        <code className="text-xs bg-stone-100 px-1 rounded">EMAIL_BULK_BCC_CHUNK_SIZE</code>). Recipients do not see each other&apos;s addresses.
      </p>

      <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50">
        <h2 className="font-semibold text-stone-800 mb-1">Send liability waiver link</h2>
        <p className="text-sm text-stone-600 mb-3">
          Send a waiver link to a member (resets their signed state so you can test). Enter Member ID (e.g. 33330562).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Member ID"
            value={waiverMemberId}
            onChange={(e) => setWaiverMemberId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-stone-200 text-sm w-40 font-mono"
          />
          <button
            type="button"
            onClick={handleSendWaiver}
            disabled={sendingWaiver || !waiverMemberId.trim()}
            className="px-4 py-2 rounded-lg border border-stone-300 bg-white font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendingWaiver ? "Sending…" : "Send waiver link"}
          </button>
        </div>
        {waiverResult && (
          <p className="mt-3 text-sm text-stone-700">
            {waiverResult.message}
            {waiverResult.url && (
              <a href={waiverResult.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-brand-600 hover:underline">
                Open waiver link
              </a>
            )}
          </p>
        )}
      </div>

      {smtpConfigured && (
        <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h2 className="font-semibold text-stone-800 mb-1">Email Groups — Filters</h2>
          <p className="text-sm text-stone-600 mb-3">
            Target members by plan status, join date, bookings, visits, leads, failed payments, or trial/complimentary expiry. All filters combine with AND.
          </p>
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <span className="text-xs font-medium text-stone-500">Plan status</span>
              <select value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[120px]">
                <option value="">Any</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
                <option value="none">No subscription</option>
              </select>
              <span className="text-xs font-medium text-stone-500">Join date</span>
              <input type="number" min={1} max={3650} placeholder="Joined in last (days)" value={joinDateInDays === "" ? "" : joinDateInDays} onChange={(e) => setJoinDateInDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-32 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} className="rounded border-stone-300" />
                <span className="text-sm text-stone-600">Leads only (no purchase)</span>
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <span className="text-xs font-medium text-stone-500">Bookings</span>
              <input type="number" min={1} placeholder="Min class" value={minClassBookings === "" ? "" : minClassBookings} onChange={(e) => setMinClassBookings(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-20 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <input type="number" min={1} placeholder="Min PT" value={minPtBookings === "" ? "" : minPtBookings} onChange={(e) => setMinPtBookings(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-20 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <span className="text-xs font-medium text-stone-500">Visits</span>
              <input type="number" min={1} placeholder="Min" value={minVisits === "" ? "" : minVisits} onChange={(e) => setMinVisits(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-16 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <span className="text-xs text-stone-500">in last</span>
              <input type="number" min={1} max={365} placeholder="days" value={visitsInDays === "" ? "" : visitsInDays} onChange={(e) => setVisitsInDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-16 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <span className="text-xs font-medium text-stone-500">Failed payments</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={failedPayment} onChange={(e) => setFailedPayment(e.target.checked)} className="rounded border-stone-300" />
                <span className="text-sm text-stone-600">Has failed</span>
              </label>
              <input type="number" min={1} max={365} placeholder="In last (days)" value={failedPaymentDays === "" ? "" : failedPaymentDays} onChange={(e) => setFailedPaymentDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-24 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <select value={failedPaymentPlanId === "" ? "" : failedPaymentPlanId} onChange={(e) => setFailedPaymentPlanId(e.target.value === "" ? "" : parseInt(e.target.value, 10))} className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[140px]">
                <option value="">Any plan</option>
                {groupOptions?.plans?.map((p) => <option key={p.id} value={p.id}>{p.plan_name}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <span className="text-xs font-medium text-stone-500">Trial / Complimentary</span>
              <input type="number" min={1} max={365} placeholder="Expired in last (days)" value={trialExpiredDays === "" ? "" : trialExpiredDays} onChange={(e) => setTrialExpiredDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-36 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
              <select value={compProductType} onChange={(e) => { setCompProductType(e.target.value); setCompProductId(""); }} className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[140px]">
                <option value="">All types</option>
                <option value="membership_plan">Membership plan</option>
                <option value="pt_session">PT session</option>
                <option value="class">Class</option>
                <option value="class_pack">Class pack</option>
                <option value="pt_pack">PT pack</option>
              </select>
            {compProductType === "membership_plan" && groupOptions?.plans && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Plan</label>
                <select
                  value={compProductId === "" ? "" : compProductId}
                  onChange={(e) => setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                >
                  <option value="">Any plan</option>
                  {groupOptions.plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.plan_name}</option>
                  ))}
                </select>
              </div>
            )}
            {compProductType === "pt_session" && groupOptions?.sessions && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">PT session</label>
                <select
                  value={compProductId === "" ? "" : compProductId}
                  onChange={(e) => setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                >
                  <option value="">Any session</option>
                  {groupOptions.sessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.session_name}</option>
                  ))}
                </select>
              </div>
            )}
            {compProductType === "class" && groupOptions?.classes && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Class</label>
                <select
                  value={compProductId === "" ? "" : compProductId}
                  onChange={(e) => setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                >
                  <option value="">Any class</option>
                  {groupOptions.classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.class_name}</option>
                  ))}
                </select>
              </div>
            )}
            {compProductType === "class_pack" && groupOptions?.classPacks && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Class pack</label>
                <select
                  value={compProductId === "" ? "" : compProductId}
                  onChange={(e) => setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                >
                  <option value="">Any pack</option>
                  {groupOptions.classPacks.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            {compProductType === "pt_pack" && groupOptions?.ptPackProducts && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">PT pack</label>
                <select
                  value={compProductId === "" ? "" : compProductId}
                  onChange={(e) => setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                >
                  <option value="">Any pack</option>
                  {groupOptions.ptPackProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
              <button
                type="button"
                onClick={fetchFilteredMembers}
                disabled={loadingFiltered}
                className="px-4 py-2 rounded-lg border border-stone-300 bg-white font-medium hover:bg-stone-50 disabled:opacity-50"
              >
                {loadingFiltered ? "Loading…" : "Apply filters"}
              </button>
            </div>
          </div>
          {filteredMembers !== null && (
            <div className="mb-3">
              <p className="text-sm text-stone-600 mb-2">
                <strong>{filteredMembers.count}</strong> member{filteredMembers.count !== 1 ? "s" : ""} match.
              </p>
              {filteredMembers.count > 0 && (
                <form onSubmit={handleSendToFilteredGroup} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={groupSubject}
                      onChange={(e) => setGroupSubject(e.target.value)}
                      placeholder="e.g. Your trial has ended — continue with us!"
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Message</label>
                    <textarea
                      value={groupText}
                      onChange={(e) => setGroupText(e.target.value)}
                      placeholder="Type your message…"
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm resize-y"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={sendingGroup}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {sendingGroup ? "Sending…" : `Send to filtered group (${filteredMembers.count})`}
                  </button>
                  {groupResult && (
                    <p className="text-sm text-stone-600">
                      Sent to <strong>{groupResult.sent}</strong> of {groupResult.total}
                      {groupResult.batches != null && groupResult.batches > 0 && (
                        <> — {groupResult.batches} BCC batch{groupResult.batches !== 1 ? "es" : ""}</>
                      )}
                      .
                      {groupResult.failed > 0 && groupResult.errors && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-amber-700">{groupResult.failed} failed</summary>
                          <ul className="mt-1 text-xs list-disc list-inside">{groupResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}</ul>
                        </details>
                      )}
                    </p>
                  )}
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {smtpConfigured && (
        <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h2 className="font-semibold text-stone-800 mb-1">Resend welcome emails</h2>
          <p className="text-sm text-stone-600 mb-3">
            Send the app install link, their <strong>Member ID</strong>, and the set-password link. With <strong>Onboarding only</strong> on, we only include people with an <strong>active membership</strong> (at least one Active subscription) who still need a password and/or waiver — not churned members. Anyone who buys again gets the normal purchase email.
          </p>
          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={welcomeOnboardingOnly}
              onChange={(e) => setWelcomeOnboardingOnly(e.target.checked)}
              className="rounded border-stone-300 mt-1"
            />
            <span className="text-sm text-stone-700">
              <strong>Onboarding only:</strong> active members only (Active subscription) who still need an app password <strong>and/or</strong> haven&apos;t signed the liability waiver.
            </span>
          </label>
          <p className="text-sm text-stone-500 mb-3">
            {loadingWelcomeMembers ? (
              "Loading…"
            ) : (
              <>
                <strong>{welcomeMembers.length}</strong> member{welcomeMembers.length !== 1 ? "s" : ""} match this send
                {welcomeOnboardingOnly ? "" : ` (all ${recipientCount ?? "—"} with email)`}.
              </>
            )}
          </p>
          {idsResult && (
            <div className="bg-white border border-stone-200 rounded-lg p-3 text-sm text-stone-700 mb-3">
              Sent to <strong>{idsResult.sent}</strong> of {idsResult.total}.{" "}
              {idsResult.failed > 0 && idsResult.errors && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-amber-700">{idsResult.failed} failed</summary>
                  <ul className="mt-1 text-xs list-disc list-inside">{idsResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={handleSendMemberIds}
            disabled={sendingIds || loadingWelcomeMembers || welcomeMembers.length === 0}
            className="px-4 py-2 rounded-lg border border-stone-300 bg-white font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendingIds ? "Sending…" : "Resend welcome emails (matched list)"}
          </button>
        </div>
      )}

      {smtpConfigured && (
        <div className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h2 className="font-semibold text-stone-800 mb-1">Send welcome email to selected members</h2>
          <p className="text-sm text-stone-600 mb-3">
            Pick from the same list as above (respects <strong>Onboarding only</strong> — active members only when that&apos;s on). Sends install link, Member ID, and set-password link.
          </p>
          {loadingWelcomeMembers ? (
            <p className="text-sm text-stone-500">Loading members…</p>
          ) : welcomeMembers.length === 0 ? (
            <p className="text-sm text-stone-500">No members with an email address.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <input
                  type="search"
                  placeholder="Search by name, email, or Member ID"
                  value={welcomeSearch}
                  onChange={(e) => setWelcomeSearch(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-stone-200 text-sm"
                />
                <button
                  type="button"
                  onClick={allFilteredSelected ? deselectAll : selectAll}
                  className="px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-50"
                >
                  {allFilteredSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto border border-stone-200 rounded-lg bg-white divide-y divide-stone-100">
                {filteredWelcomeMembers.map((m) => {
                  const name = [m.first_name, m.last_name].filter(Boolean).join(" ") || "—";
                  const checked = selectedIds.has(m.member_id);
                  return (
                    <label
                      key={m.member_id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-stone-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(m.member_id)}
                        className="rounded border-stone-300"
                      />
                      <span className="text-sm text-stone-800 truncate flex-1">{name}</span>
                      <span className="text-xs text-stone-500 truncate max-w-[140px]">{m.email}</span>
                      <span className="text-xs text-stone-400 font-mono">{m.member_id}</span>
                    </label>
                  );
                })}
              </div>
              {filteredWelcomeMembers.length === 0 && welcomeSearch.trim() && (
                <p className="text-sm text-stone-500 mt-2">No members match your search.</p>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSendToSelected}
                  disabled={selectedCount === 0 || sendingSelected}
                  className="px-4 py-2 rounded-lg border border-stone-300 bg-white font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingSelected ? "Sending…" : `Send welcome email to selected (${selectedCount})`}
                </button>
                {selectedResult && (
                  <span className="text-sm text-stone-600">
                    Sent to <strong>{selectedResult.sent}</strong> of {selectedResult.total}.
                    {selectedResult.failed > 0 && selectedResult.errors && (
                      <details className="inline ml-1">
                        <summary className="cursor-pointer text-amber-700">Details</summary>
                        <ul className="text-xs list-disc list-inside">{selectedResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}</ul>
                      </details>
                    )}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {loadingCount ? (
        <p className="text-stone-500 text-sm">Loading…</p>
      ) : smtpConfigured === false ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-900">
          <p className="font-medium mb-2">Email is not configured</p>
          <p className="text-sm mb-3">
            Use one of these options (set env vars in Railway or your host, then redeploy):
          </p>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-amber-800 mb-1">Option 1: Gmail API (recommended if SMTP is blocked)</p>
              <p className="mb-1">Uses HTTPS so it works on Railway and other hosts that block SMTP. You need a Google Cloud project, Gmail API enabled, and OAuth credentials. Set:</p>
              <ul className="list-disc list-inside font-mono text-amber-800">
                <li>GMAIL_OAUTH_CLIENT_ID</li>
                <li>GMAIL_OAUTH_CLIENT_SECRET</li>
                <li>GMAIL_OAUTH_REFRESH_TOKEN</li>
                <li>GMAIL_FROM_EMAIL (your Gmail address)</li>
              </ul>
              <p className="mt-2 text-xs">Step-by-step: see <code className="bg-amber-100 px-1 rounded">docs/EMAIL_GMAIL_API_SETUP.md</code> in the repo.</p>
            </div>
            <div>
              <p className="font-medium text-amber-800 mb-1">Option 2: SMTP</p>
              <ul className="list-disc list-inside font-mono text-amber-800">
                <li>SMTP_HOST (e.g. smtp.gmail.com)</li>
                <li>SMTP_USER</li>
                <li>SMTP_PASS</li>
              </ul>
            </div>
          </div>
        </div>
      ) : recipientCount === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          No members have an email address. Add emails in the member directory first.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-stone-600">
            <strong>{recipientCount}</strong> member{recipientCount !== 1 ? "s" : ""} will receive this email (sent in BCC batches, not one API call per person).
          </p>
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Class schedule update"
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200"
              required
            />
          </div>
          <div>
            <label htmlFor="text" className="block text-sm font-medium text-stone-700 mb-1">Message</label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your message…"
              rows={8}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-200 resize-y"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-sm text-stone-700">
              <p>
                Sent to <strong>{result.sent}</strong> of {result.total} member{result.total !== 1 ? "s" : ""}
                {result.batches != null && result.batches > 0 && (
                  <> — {result.batches} BCC batch{result.batches !== 1 ? "es" : ""}</>
                )}
                .
              </p>
              {result.failed > 0 && result.errors && result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-amber-700">{result.failed} failed</summary>
                  <ul className="mt-1 text-xs text-stone-600 list-disc list-inside">{result.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}</ul>
                  {result.errors.length > 10 && <p className="mt-1 text-xs text-stone-500">… and {result.errors.length - 10} more</p>}
                </details>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to all members"}
          </button>
        </form>
      )}
    </div>
  );
}
