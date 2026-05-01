"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  createFetchTimeoutSignal,
  FETCH_TIMEOUT_WELCOME_EMAIL_MS,
  isFetchAbortError,
} from "@/lib/client-fetch-timeout";

type MemberRow = {
  member_id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};
type MemberWithEmail = { member_id: string; email: string; first_name: string | null; last_name: string | null };

type RecipientScope = "everyone" | "one_member" | "filtered" | "onboarding";
type MessageKind = "custom" | "welcome_invite" | "waiver_link";

function allowedMessageKinds(scope: RecipientScope): MessageKind[] {
  switch (scope) {
    case "everyone":
      return ["custom"];
    case "one_member":
      return ["custom", "welcome_invite", "waiver_link"];
    case "filtered":
      return ["custom"];
    case "onboarding":
      return ["custom", "welcome_invite"];
    default:
      return ["custom"];
  }
}

function messageKindLabel(k: MessageKind): string {
  switch (k) {
    case "custom":
      return "Write your own (subject + message)";
    case "welcome_invite":
      return "Welcome email — Member ID, install link, set password";
    case "waiver_link":
      return "Liability waiver link";
    default:
      return k;
  }
}

export default function AdminEmailMembersPage() {
  const [recipientScope, setRecipientScope] = useState<RecipientScope>("everyone");
  const [messageKind, setMessageKind] = useState<MessageKind>("custom");

  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [loadingCount, setLoadingCount] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    total: number;
    failed: number;
    batches?: number;
    errors?: string[];
    label?: string;
    waiverUrl?: string;
  } | null>(null);

  const [allMembers, setAllMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [oneMemberId, setOneMemberId] = useState("");
  const [memberPickSearch, setMemberPickSearch] = useState("");

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

  const [welcomeMembers, setWelcomeMembers] = useState<MemberWithEmail[]>([]);
  const [loadingWelcomeMembers, setLoadingWelcomeMembers] = useState(false);
  const [welcomeOnboardingOnly, setWelcomeOnboardingOnly] = useState(true);
  const [welcomeSearch, setWelcomeSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
    const allowed = allowedMessageKinds(recipientScope);
    setMessageKind((prev) => (allowed.includes(prev) ? prev : allowed[0]));
  }, [recipientScope]);

  useEffect(() => {
    if (!smtpConfigured || recipientScope !== "one_member") return;
    setLoadingMembers(true);
    fetch("/api/members")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: MemberRow[]) => setAllMembers(Array.isArray(list) ? list : []))
      .catch(() => setAllMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [smtpConfigured, recipientScope]);

  useEffect(() => {
    if (!smtpConfigured || recipientScope !== "onboarding") return;
    setSelectedIds(new Set());
    const q = welcomeOnboardingOnly ? "?filter=needs_password_or_waiver" : "";
    setLoadingWelcomeMembers(true);
    fetch(`/api/admin/email-member-ids${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members?: MemberWithEmail[] } | null) => {
        setWelcomeMembers(data?.members ?? []);
      })
      .catch(() => setWelcomeMembers([]))
      .finally(() => setLoadingWelcomeMembers(false));
  }, [smtpConfigured, recipientScope, welcomeOnboardingOnly]);

  useEffect(() => {
    if (!smtpConfigured || recipientScope !== "filtered") return;
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
  }, [smtpConfigured, recipientScope]);

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

  const membersPickList = useMemo(() => {
    const withEmail = allMembers.filter((m) => (m.email ?? "").trim());
    const q = memberPickSearch.trim().toLowerCase();
    if (!q) return withEmail;
    return withEmail.filter(
      (m) =>
        (m.first_name ?? "").toLowerCase().includes(q) ||
        (m.last_name ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q) ||
        m.member_id.toLowerCase().includes(q)
    );
  }, [allMembers, memberPickSearch]);

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

  const onboardingSelectedCount = selectedIds.size;

  const recipientSummary = useMemo(() => {
    if (!smtpConfigured) return "";
    switch (recipientScope) {
      case "everyone":
        return `${recipientCount ?? "—"} member${(recipientCount ?? 0) !== 1 ? "s" : ""} with email`;
      case "one_member":
        return oneMemberId.trim() ? `1 member (${oneMemberId.trim()})` : "Pick a member below";
      case "filtered":
        return filteredMembers ? `${filteredMembers.count} member${filteredMembers.count !== 1 ? "s" : ""} match` : "Apply filters to count recipients";
      case "onboarding":
        if (loadingWelcomeMembers) return "Loading roster…";
        {
          const n = onboardingSelectedCount > 0 ? onboardingSelectedCount : welcomeMembers.length;
          return `${n} recipient${n !== 1 ? "s" : ""}${onboardingSelectedCount > 0 ? " (selected)" : " (whole roster)"}`;
        }
      default:
        return "";
    }
  }, [
    smtpConfigured,
    recipientScope,
    recipientCount,
    oneMemberId,
    filteredMembers,
    welcomeMembers.length,
    loadingWelcomeMembers,
    onboardingSelectedCount,
  ]);

  const selectAllOnboarding = () => setSelectedIds(new Set(filteredWelcomeMembers.map((m) => m.member_id)));
  const deselectAllOnboarding = () => setSelectedIds(new Set());
  const toggleOnboarding = (member_id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(member_id)) next.delete(member_id);
      else next.add(member_id);
      return next;
    });
  };

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (messageKind === "custom") {
      const sub = subject.trim();
      const body = text.trim();
      if (!sub || !body) {
        setError("Subject and message are required.");
        return;
      }
      let member_ids: string[] | undefined;

      if (recipientScope === "everyone") {
        member_ids = undefined;
      } else if (recipientScope === "one_member") {
        const mid = oneMemberId.trim();
        if (!mid) {
          setError("Choose a member.");
          return;
        }
        member_ids = [mid];
      } else if (recipientScope === "filtered") {
        if (!filteredMembers || filteredMembers.count === 0) {
          setError("Apply filters first and ensure at least one member matches.");
          return;
        }
        member_ids = filteredMembers.member_ids;
      } else if (recipientScope === "onboarding") {
        const ids =
          selectedIds.size > 0 ? Array.from(selectedIds) : welcomeMembers.map((m) => m.member_id);
        if (ids.length === 0) {
          setError("No members on this roster — widen the list or adjust onboarding filter.");
          return;
        }
        member_ids = ids;
      }

      setSending(true);
      try {
        const res = await fetch("/api/admin/email-all-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: sub,
            text: body,
            ...(member_ids ? { member_ids } : {}),
          }),
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
          label: "Custom email",
        });
        setSubject("");
        setText("");
      } catch {
        setError("Something went wrong.");
      } finally {
        setSending(false);
      }
      return;
    }

    if (messageKind === "welcome_invite") {
      setSending(true);
      const { signal, clear } = createFetchTimeoutSignal(FETCH_TIMEOUT_WELCOME_EMAIL_MS);
      try {
        if (recipientScope === "one_member") {
          const mid = oneMemberId.trim();
          if (!mid) {
            setError("Choose a member.");
            setSending(false);
            clear();
            return;
          }
          const res = await fetch("/api/admin/email-member-ids", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_ids: [mid], filter: "all" }),
            signal,
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
            errors: data.errors,
            label: "Welcome email",
          });
        } else {
          const body =
            selectedIds.size > 0
              ? {
                  member_ids: Array.from(selectedIds),
                  filter: welcomeOnboardingOnly ? "needs_password_or_waiver" : "all",
                }
              : { filter: welcomeOnboardingOnly ? "needs_password_or_waiver" : "all" };
          const res = await fetch("/api/admin/email-member-ids", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
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
            errors: data.errors,
            label: "Welcome email",
          });
          setSelectedIds(new Set());
        }
      } catch (e) {
        if (isFetchAbortError(e)) {
          setError(
            "Request timed out — some emails may have been sent. Check logs or send in smaller batches."
          );
        } else {
          setError("Something went wrong.");
        }
      } finally {
        clear();
        setSending(false);
      }
      return;
    }

    if (messageKind === "waiver_link") {
      const mid = oneMemberId.trim();
      if (!mid) {
        setError("Choose a member.");
        return;
      }
      setSending(true);
      try {
        const res = await fetch("/api/waiver/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member_id: mid }),
        });
        const json = await res.json();
        if (res.ok) {
          setResult({
            sent: 1,
            total: 1,
            failed: 0,
            label: typeof json.message === "string" ? json.message : "Waiver link sent",
            waiverUrl: typeof json.waiver_url === "string" ? json.waiver_url : undefined,
          });
        } else {
          setError(json.error ?? "Failed to send waiver.");
        }
      } catch {
        setError("Something went wrong.");
      } finally {
        setSending(false);
      }
    }
  }

  const canSubmit =
    smtpConfigured &&
    !loadingCount &&
    (recipientScope !== "filtered" || (filteredMembers !== null && filteredMembers.count > 0)) &&
    (recipientScope !== "one_member" || oneMemberId.trim()) &&
    (recipientScope !== "onboarding" || welcomeMembers.length > 0);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <Link href="/members" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Members
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Email members</h1>
      <p className="text-stone-500 text-sm mb-6">
        Choose who receives the message, then pick a template or write your own. Broadcasts use chunked BCC (recipients
        don&apos;t see each other). Welcome and waiver sends go one at a time per member. Gmail uses small BCC batches (
        <code className="text-xs bg-stone-100 px-1 rounded">EMAIL_GMAIL_BCC_CHUNK</code>); SMTP uses{" "}
        <code className="text-xs bg-stone-100 px-1 rounded">EMAIL_BULK_BCC_CHUNK_SIZE</code>.
      </p>

      {loadingCount ? (
        <p className="text-stone-500 text-sm">Loading…</p>
      ) : smtpConfigured === false ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-900 mb-8">
          <p className="font-medium mb-2">Email is not configured</p>
          <p className="text-sm mb-3">Set SMTP or Gmail API env vars, redeploy, then return here.</p>
          <div className="space-y-3 text-sm font-mono text-amber-800">
            <p>GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_FROM_EMAIL</p>
            <p>or SMTP_HOST, SMTP_USER, SMTP_PASS</p>
          </div>
        </div>
      ) : recipientCount === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm mb-8">
          No members have an email address yet.
        </div>
      ) : (
        <form onSubmit={handleSend} className="space-y-8">
          <section className="p-4 rounded-xl border border-stone-200 bg-white space-y-3">
            <h2 className="font-semibold text-stone-800">1. Who should receive this?</h2>
            <select
              value={recipientScope}
              onChange={(e) => {
                setRecipientScope(e.target.value as RecipientScope);
                setFilteredMembers(null);
                setError(null);
                setResult(null);
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm font-medium text-stone-800 bg-white"
            >
              <option value="everyone">All members with email ({recipientCount ?? "—"})</option>
              <option value="one_member">One member</option>
              <option value="filtered">Filtered segment (plans, visits, leads, failed payments, …)</option>
              <option value="onboarding">Onboarding roster (password / waiver reminders)</option>
            </select>
            <p className="text-sm text-stone-600">{recipientSummary}</p>

            {recipientScope === "one_member" && (
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <input
                  type="search"
                  placeholder="Search members…"
                  value={memberPickSearch}
                  onChange={(e) => setMemberPickSearch(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                />
                {loadingMembers ? (
                  <p className="text-sm text-stone-500">Loading members…</p>
                ) : (
                  <select
                    value={oneMemberId}
                    onChange={(e) => setOneMemberId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                  >
                    <option value="">— Select member —</option>
                    {membersPickList.map((m) => {
                      const name = [m.first_name, m.last_name].filter(Boolean).join(" ") || "—";
                      return (
                        <option key={m.member_id} value={m.member_id}>
                          {name} · {m.email ?? "no email"} · {m.member_id}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            )}

            {recipientScope === "filtered" && (
              <div className="space-y-4 pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-500">Filters combine with AND. Click Apply to load recipients.</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Plan status</label>
                    <select
                      value={planStatus}
                      onChange={(e) => setPlanStatus(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[120px]"
                    >
                      <option value="">Any</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="none">No subscription</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Joined in last (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={joinDateInDays === "" ? "" : joinDateInDays}
                      onChange={(e) =>
                        setJoinDateInDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-28 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer mt-5">
                    <input type="checkbox" checked={isLead} onChange={(e) => setIsLead(e.target.checked)} className="rounded border-stone-300" />
                    <span className="text-sm text-stone-600">Leads only</span>
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Min class bookings</label>
                    <input
                      type="number"
                      min={1}
                      value={minClassBookings === "" ? "" : minClassBookings}
                      onChange={(e) =>
                        setMinClassBookings(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-20 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Min PT bookings</label>
                    <input
                      type="number"
                      min={1}
                      value={minPtBookings === "" ? "" : minPtBookings}
                      onChange={(e) =>
                        setMinPtBookings(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-20 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Min visits</label>
                    <input
                      type="number"
                      min={1}
                      value={minVisits === "" ? "" : minVisits}
                      onChange={(e) =>
                        setMinVisits(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-16 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">…in last (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={visitsInDays === "" ? "" : visitsInDays}
                      onChange={(e) =>
                        setVisitsInDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-20 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={failedPayment} onChange={(e) => setFailedPayment(e.target.checked)} className="rounded border-stone-300" />
                    <span className="text-sm text-stone-600">Failed payment</span>
                  </label>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">In last (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={failedPaymentDays === "" ? "" : failedPaymentDays}
                      onChange={(e) =>
                        setFailedPaymentDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-24 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Plan</label>
                    <select
                      value={failedPaymentPlanId === "" ? "" : failedPaymentPlanId}
                      onChange={(e) =>
                        setFailedPaymentPlanId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                      }
                      className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[140px]"
                    >
                      <option value="">Any plan</option>
                      {groupOptions?.plans?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.plan_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Trial / complimentary expired (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={trialExpiredDays === "" ? "" : trialExpiredDays}
                      onChange={(e) =>
                        setTrialExpiredDays(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-28 px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Product type</label>
                    <select
                      value={compProductType}
                      onChange={(e) => {
                        setCompProductType(e.target.value);
                        setCompProductId("");
                      }}
                      className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[140px]"
                    >
                      <option value="">All types</option>
                      <option value="membership_plan">Membership plan</option>
                      <option value="pt_session">PT session</option>
                      <option value="class">Class</option>
                      <option value="class_pack">Class pack</option>
                      <option value="pt_pack">PT pack</option>
                    </select>
                  </div>
                  {compProductType === "membership_plan" && groupOptions?.plans && (
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Plan</label>
                      <select
                        value={compProductId === "" ? "" : compProductId}
                        onChange={(e) =>
                          setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                        }
                        className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                      >
                        <option value="">Any plan</option>
                        {groupOptions.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.plan_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {compProductType === "pt_session" && groupOptions?.sessions && (
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">PT session</label>
                      <select
                        value={compProductId === "" ? "" : compProductId}
                        onChange={(e) =>
                          setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                        }
                        className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                      >
                        <option value="">Any session</option>
                        {groupOptions.sessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.session_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {compProductType === "class" && groupOptions?.classes && (
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Class</label>
                      <select
                        value={compProductId === "" ? "" : compProductId}
                        onChange={(e) =>
                          setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                        }
                        className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                      >
                        <option value="">Any class</option>
                        {groupOptions.classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.class_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {compProductType === "class_pack" && groupOptions?.classPacks && (
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Class pack</label>
                      <select
                        value={compProductId === "" ? "" : compProductId}
                        onChange={(e) =>
                          setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                        }
                        className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                      >
                        <option value="">Any pack</option>
                        {groupOptions.classPacks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {compProductType === "pt_pack" && groupOptions?.ptPackProducts && (
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">PT pack</label>
                      <select
                        value={compProductId === "" ? "" : compProductId}
                        onChange={(e) =>
                          setCompProductId(e.target.value === "" ? "" : parseInt(e.target.value, 10))
                        }
                        className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[160px]"
                      >
                        <option value="">Any pack</option>
                        {groupOptions.ptPackProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={fetchFilteredMembers}
                    disabled={loadingFiltered}
                    className="px-4 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 disabled:opacity-50"
                  >
                    {loadingFiltered ? "Loading…" : "Apply filters"}
                  </button>
                </div>
              </div>
            )}

            {recipientScope === "onboarding" && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={welcomeOnboardingOnly}
                    onChange={(e) => setWelcomeOnboardingOnly(e.target.checked)}
                    className="rounded border-stone-300 mt-1"
                  />
                  <span className="text-sm text-stone-700">
                    <strong>Onboarding only:</strong> active subscription + still needs app password and/or unsigned waiver.
                  </span>
                </label>
                {loadingWelcomeMembers ? (
                  <p className="text-sm text-stone-500">Loading roster…</p>
                ) : welcomeMembers.length === 0 ? (
                  <p className="text-sm text-stone-500">No members match.</p>
                ) : (
                  <>
                    <input
                      type="search"
                      placeholder="Search roster…"
                      value={welcomeSearch}
                      onChange={(e) => setWelcomeSearch(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllOnboarding}
                        className="text-sm px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50"
                      >
                        Select all visible
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllOnboarding}
                        className="text-sm px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50"
                      >
                        Clear selection
                      </button>
                    </div>
                    <p className="text-xs text-stone-500">
                      Leave none selected to send to the <strong>whole roster</strong>. With a selection, only checked members get the email.
                    </p>
                    <div className="max-h-52 overflow-y-auto border border-stone-200 rounded-lg bg-stone-50 divide-y divide-stone-100">
                      {filteredWelcomeMembers.map((m) => {
                        const name = [m.first_name, m.last_name].filter(Boolean).join(" ") || "—";
                        const checked = selectedIds.has(m.member_id);
                        return (
                          <label
                            key={m.member_id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-white cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOnboarding(m.member_id)}
                              className="rounded border-stone-300"
                            />
                            <span className="text-sm text-stone-800 truncate flex-1">{name}</span>
                            <span className="text-xs text-stone-500 truncate max-w-[120px]">{m.email}</span>
                            <span className="text-xs font-mono text-stone-400">{m.member_id}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="p-4 rounded-xl border border-stone-200 bg-white space-y-3">
            <h2 className="font-semibold text-stone-800">2. What should we send?</h2>
            <select
              value={messageKind}
              onChange={(e) => setMessageKind(e.target.value as MessageKind)}
              className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm font-medium text-stone-800 bg-white"
            >
              {allowedMessageKinds(recipientScope).map((k) => (
                <option key={k} value={k}>
                  {messageKindLabel(k)}
                </option>
              ))}
            </select>
            {messageKind === "custom" && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Schedule update"
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Message</label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type your message…"
                    rows={8}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm resize-y"
                  />
                </div>
              </div>
            )}
            {(messageKind === "welcome_invite" || messageKind === "waiver_link") && (
              <p className="text-sm text-stone-600 pt-1">
                {messageKind === "welcome_invite"
                  ? "Uses the standard welcome email for each recipient (install link, Member ID, set password)."
                  : "Sends the liability waiver link to the selected member (testing / resend)."}
              </p>
            )}
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-950">
              <p className="font-medium">{result.label ?? "Sent"}</p>
              <p className="mt-1">
                Reached <strong>{result.sent}</strong> of {result.total}
                {result.batches != null && result.batches > 0 && (
                  <>
                    {" "}
                    ({result.batches} BCC batch{result.batches !== 1 ? "es" : ""})
                  </>
                )}
                .
              </p>
              {result.waiverUrl && (
                <a
                  href={result.waiverUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-brand-600 hover:underline font-medium"
                >
                  Open waiver link
                </a>
              )}
              {result.failed > 0 && result.errors && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-amber-800">{result.failed} failed</summary>
                  <ul className="mt-1 text-xs list-disc list-inside">{result.errors.slice(0, 8).map((err, i) => <li key={i}>{err}</li>)}</ul>
                </details>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={
              sending ||
              !canSubmit ||
              (recipientScope === "filtered" && (!filteredMembers || filteredMembers.count === 0))
            }
            className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
