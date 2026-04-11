"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import {
  createFetchTimeoutSignal,
  FETCH_TIMEOUT_EMAIL_MS,
  isFetchAbortError,
} from "@/lib/client-fetch-timeout";

type Member = Record<string, unknown>;

function buildMemberEditForm(m: Record<string, unknown>) {
  return {
    first_name: String(m.first_name ?? ""),
    last_name: String(m.last_name ?? ""),
    email: String(m.email ?? ""),
    phone: String(m.phone ?? ""),
    role: String(m.role ?? "Member"),
    join_date: String(m.join_date ?? ""),
    exp_next_payment_date: String(m.exp_next_payment_date ?? ""),
    preferred_name: String(m.preferred_name ?? ""),
    pronouns: String(m.pronouns ?? ""),
    birthday: String(m.birthday ?? ""),
    mailing_address: String(m.mailing_address ?? ""),
    emergency_contact_name: String(m.emergency_contact_name ?? ""),
    emergency_contact_phone: String(m.emergency_contact_phone ?? ""),
    emergency_info: String(m.emergency_info ?? ""),
    spirit_animal: String(m.spirit_animal ?? ""),
  };
}
type LinkedRow = Record<string, unknown>;

export default function MemberDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const tz = useAppTimezone();
  const [data, setData] = useState<{
    member: Member;
    subscriptions: LinkedRow[];
    class_credits?: number;
    today_ymd?: string;
    has_door_access?: boolean;
    classBookings: LinkedRow[];
    ptBookings: LinkedRow[];
    ptSlotBookings?: LinkedRow[];
    ptTrainerSpecificBookings?: LinkedRow[];
    ptOpenBookings?: LinkedRow[];
    sales: LinkedRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [unlocking, setUnlocking] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ role: string } | null | undefined>(undefined);
  const [adminAction, setAdminAction] = useState<string | null>(null);
  const [changingCard, setChangingCard] = useState(false);
  const [complimentaryProducts, setComplimentaryProducts] = useState<{
    plans: { id: number; plan_name: string; price: string }[];
    sessions: { id: number; session_name: string; price: string }[];
    classes: { id: number; class_name: string; price: string }[];
    classPacks: { id: number; name: string; price: string; credits: number }[];
    ptPackProducts: { id: number; name: string; price: string; credits: number; duration_minutes: number }[];
  } | null>(null);
  const [compProductType, setCompProductType] = useState<string>("membership_plan");
  const [compProductId, setCompProductId] = useState<number | "">("");
  const [compQuantity, setCompQuantity] = useState(1);
  const [compFreeMonths, setCompFreeMonths] = useState<number | "">("");
  const [compSubmitting, setCompSubmitting] = useState(false);
  const [compMessage, setCompMessage] = useState<string | null>(null);
  const [ptCreditBalances, setPtCreditBalances] = useState<Record<number, number> | null>(null);
  const [ptGrantDuration, setPtGrantDuration] = useState("");
  const [ptGrantAmount, setPtGrantAmount] = useState(1);
  const [ptGrantNote, setPtGrantNote] = useState("");
  const [ptGrantSubmitting, setPtGrantSubmitting] = useState(false);
  const [ptGrantMessage, setPtGrantMessage] = useState<string | null>(null);
  const [sendingWaiver, setSendingWaiver] = useState(false);
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);
  const [togglingAutoRenew, setTogglingAutoRenew] = useState(false);
  const [waiverResult, setWaiverResult] = useState<{ message: string; url?: string } | null>(null);
  const [passwordResetMessage, setPasswordResetMessage] = useState<string | null>(null);
  const [unlocks, setUnlocks] = useState<{ id: number; lock_id: number | null; lock_name: string | null; success: number; happened_at: string }[]>([]);
  const searchParams = useSearchParams();

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const cardUpdated = searchParams.get("card_updated");
    if (sessionId && cardUpdated) {
      fetch(`/api/members/${id}/setup-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      })
        .then(() => fetchMember())
        .finally(() => window.history.replaceState({}, "", `/members/${id}`));
    }
  }, [id, searchParams]);

  async function changeCardOnFile() {
    setChangingCard(true);
    try {
      const res = await fetch(`/api/members/${id}/update-payment-method`, { method: "POST" });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else alert(json.error ?? "Could not start update");
    } finally {
      setChangingCard(false);
    }
  }

  async function fetchMember() {
    try {
      const res = await fetch(`/api/members/${id}`);
      if (!res.ok) {
        if (res.status === 404) setError("Member not found");
        else setError("Failed to load member");
        return;
      }
      const json = await res.json();
      setData(json);
      setEditForm(buildMemberEditForm((json.member ?? {}) as Record<string, unknown>));
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchMember();
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setCurrentUser(data ? { role: data.role ?? "Member" } : null))
      .catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/members/${id}/cart-data`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.plans) setComplimentaryProducts({
          plans: json.plans ?? [],
          sessions: json.sessions ?? [],
          classes: json.classes ?? [],
          classPacks: json.classPacks ?? [],
          ptPackProducts: json.ptPackProducts ?? [],
        });
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/members/${id}/unlocks?limit=10`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setUnlocks(json?.unlocks ?? []))
      .catch(() => setUnlocks([]));
  }, [id]);

  useEffect(() => {
    if (!id || currentUser?.role !== "Admin") return;
    fetch(`/api/members/${id}/pt-credits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && typeof json === "object" && !("error" in json)) setPtCreditBalances(json as Record<number, number>);
        else setPtCreditBalances({});
      })
      .catch(() => setPtCreditBalances({}));
  }, [id, currentUser?.role]);

  async function handleUnlock() {
    const mid = data?.member?.member_id as string;
    if (!mid) return;
    setUnlockMessage(null);
    setUnlocking(true);
    try {
      const res = await fetch("/api/kisi/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: mid }),
      });
      const json = await res.json();
      if (res.ok) {
        setUnlockMessage("Door unlocked.");
      } else {
        setUnlockMessage(json.error ?? "Unlock failed.");
      }
    } catch {
      setUnlockMessage("Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSendWaiver() {
    const mid = data?.member?.member_id as string;
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

  async function handleSendPasswordReset() {
    setPasswordResetMessage(null);
    setSendingPasswordReset(true);
    const { signal, clear } = createFetchTimeoutSignal(FETCH_TIMEOUT_EMAIL_MS);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(id)}/send-password-reset`, {
        method: "POST",
        signal,
      });
      const json = (await res.json()) as { error?: string; message?: string };
      if (res.ok) {
        setPasswordResetMessage(json.message ?? "Password reset email sent.");
      } else {
        setPasswordResetMessage(json.error ?? "Could not send reset email.");
      }
    } catch (e) {
      if (isFetchAbortError(e)) {
        setPasswordResetMessage(
          "Request timed out — email may still send. Check your SMTP or try again in a minute."
        );
      } else {
        setPasswordResetMessage("Could not send reset email.");
      }
    } finally {
      clear();
      setSendingPasswordReset(false);
    }
  }

  const isAdmin = currentUser?.role === "Admin";

  async function cancelSubscription(subscriptionId: string) {
    setAdminAction("sub");
    try {
      const res = await fetch("/api/admin/subscriptions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_id: subscriptionId }),
      });
      const json = await res.json();
      if (res.ok) fetchMember();
      else alert(json.error ?? "Failed");
    } finally {
      setAdminAction(null);
    }
  }

  async function cancelPTBooking(type: "slot" | "trainer_specific" | "open", id: number) {
    setAdminAction("pt");
    try {
      const res = await fetch("/api/admin/pt-bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      const json = await res.json();
      if (res.ok) fetchMember();
      else alert(json.error ?? "Failed");
    } finally {
      setAdminAction(null);
    }
  }

  async function refundSale(salesId: string) {
    if (
      !confirm(
        "Refund this charge in Stripe and mark the sale as refunded here? Any membership tied to this sale will be cancelled. This cannot be undone."
      )
    ) {
      return;
    }
    setAdminAction("refund");
    try {
      const run = async (recordRefundOnly: boolean) => {
        const res = await fetch("/api/admin/sales/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sales_id: salesId, ...(recordRefundOnly ? { record_refund_only: true } : {}) }),
        });
        const json = await res.json();
        return { res, json };
      };
      let { res, json } = await run(false);
      if (res.status === 409 && json?.error) {
        if (
          confirm(
            `${String(json.error)}\n\nIf you already refunded this charge in Stripe, click OK to mark it refunded in the app only (no Stripe API call).`
          )
        ) {
          ({ res, json } = await run(true));
        } else {
          return;
        }
      }
      if (res.ok) fetchMember();
      else alert(json.error ?? "Failed");
    } finally {
      setAdminAction(null);
    }
  }

  async function grantPtCredits() {
    const dm = parseInt(ptGrantDuration, 10);
    if (Number.isNaN(dm) || dm < 1 || dm > 24 * 60) {
      setPtGrantMessage("Enter session length in minutes (1–1440), e.g. 60 or 90.");
      return;
    }
    const amt = Math.max(1, Math.min(99, Math.floor(ptGrantAmount)));
    setPtGrantMessage(null);
    setPtGrantSubmitting(true);
    try {
      const res = await fetch(`/api/members/${id}/pt-credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration_minutes: dm,
          amount: amt,
          ...(ptGrantNote.trim() ? { note: ptGrantNote.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (res.ok && json.balances) {
        setPtCreditBalances(json.balances as Record<number, number>);
        setPtGrantMessage(`Granted ${amt}×${dm}-min credit(s).`);
        setPtGrantDuration("");
        setPtGrantAmount(1);
        setPtGrantNote("");
      } else {
        setPtGrantMessage(json.error ?? "Could not grant credits.");
      }
    } catch {
      setPtGrantMessage("Request failed.");
    } finally {
      setPtGrantSubmitting(false);
    }
  }

  async function applyComplimentary() {
    const productId = compProductId === "" ? null : Number(compProductId);
    if (productId == null || Number.isNaN(productId)) {
      setCompMessage("Select a product.");
      return;
    }
    setCompMessage(null);
    setCompSubmitting(true);
    try {
      const res = await fetch(`/api/members/${id}/complimentary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_type: compProductType,
          product_id: productId,
          quantity: compQuantity,
          ...(compProductType === "membership_plan" && compFreeMonths !== "" && !Number.isNaN(Number(compFreeMonths)) ? { free_months: Number(compFreeMonths) } : {}),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setCompMessage(json.message ?? "Complimentary product applied.");
        setCompProductId("");
        setCompFreeMonths("");
        fetchMember();
      } else {
        setCompMessage(json.error ?? "Failed to apply complimentary.");
      }
    } catch {
      setCompMessage("Request failed.");
    } finally {
      setCompSubmitting(false);
    }
  }

  async function handleSaveEdit() {
    if (!data?.member) return;
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error("Failed to update");
      if (updated.kisi_sync_warning) alert(updated.kisi_sync_warning);
      setEditing(false);
      await fetchMember();
    } catch {
      setError("Failed to save");
    }
  }

  if (loading) return <div className="p-12 text-center text-stone-500">Loading…</div>;
  if (error || !data) return <div className="p-12 text-center text-red-600">{error ?? "Not found"}</div>;

  const member = data.member;
  const legalName = [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member";
  const displayHeading = String(member.preferred_name ?? "").trim() || legalName;
  const memberEmail = String(member.email ?? "").trim();
  const hasDoorAccess = Boolean(data.has_door_access);
  const canUnlockDoor = memberEmail.length > 0 && hasDoorAccess;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/members" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
        ← Back to members
      </Link>

      {isAdmin && complimentaryProducts && (
        <div className="mb-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50/80">
          <h2 className="text-base font-semibold text-stone-800 mb-3">Give complimentary product</h2>
          <p className="text-xs text-stone-600 mb-3">Waive the fee. For memberships, the app will set up Kisi door access for the chosen duration.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Product type</label>
              <select
                value={compProductType}
                onChange={(e) => { setCompProductType(e.target.value); setCompProductId(""); }}
                className="px-2 py-1.5 rounded border border-stone-200 text-sm bg-white"
              >
                <option value="membership_plan">Membership plan</option>
                <option value="pt_session">PT session</option>
                <option value="class">Class</option>
                <option value="class_pack">Class pack</option>
                <option value="pt_pack">PT pack</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Product</label>
              <select
                value={compProductId}
                onChange={(e) => setCompProductId(e.target.value === "" ? "" : Number(e.target.value))}
                className="px-2 py-1.5 rounded border border-stone-200 text-sm bg-white min-w-[160px]"
              >
                <option value="">— Select —</option>
                {compProductType === "membership_plan" && complimentaryProducts.plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.plan_name}</option>
                ))}
                {compProductType === "pt_session" && complimentaryProducts.sessions.map((p) => (
                  <option key={p.id} value={p.id}>{p.session_name}</option>
                ))}
                {compProductType === "class" && complimentaryProducts.classes.map((p) => (
                  <option key={p.id} value={p.id}>{p.class_name}</option>
                ))}
                {compProductType === "class_pack" && complimentaryProducts.classPacks.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.credits} credits)</option>
                ))}
                {compProductType === "pt_pack" && complimentaryProducts.ptPackProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.credits}×{p.duration_minutes} min)</option>
                ))}
              </select>
            </div>
            {compProductType === "membership_plan" && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Free months (optional)</label>
                <input
                  type="number"
                  min={1}
                  value={compFreeMonths === "" ? "" : compFreeMonths}
                  onChange={(e) => setCompFreeMonths(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  placeholder="Plan default"
                  className="w-24 px-2 py-1.5 rounded border border-stone-200 text-sm"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Qty</label>
              <input
                type="number"
                min={1}
                value={compQuantity}
                onChange={(e) => setCompQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={applyComplimentary}
              disabled={compSubmitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {compSubmitting ? "Applying…" : "Apply complimentary"}
            </button>
          </div>
          {compMessage && (
            <p className={`mt-3 text-sm ${compMessage.startsWith("Complimentary") ? "text-emerald-700" : "text-amber-700"}`}>
              {compMessage}
            </p>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="mb-6 p-4 rounded-xl border border-brand-200 bg-brand-50/50 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-stone-800 mb-2">Class credits</h2>
            <p className="text-xs text-stone-600 mb-2">
              Balance from class packs and complimentary class credits. Used when booking recurring / open classes with a credit.
            </p>
            <p className="text-sm text-stone-700">
              {data && (data.class_credits ?? 0) > 0 ? (
                <>
                  <strong>{data.class_credits}</strong> credit{(data.class_credits ?? 0) !== 1 ? "s" : ""} available.
                </>
              ) : (
                <span className="text-stone-500">No class credits on file.</span>
              )}
            </p>
          </div>

          <div className="pt-4 border-t border-stone-200/80">
            <h2 className="text-base font-semibold text-stone-800 mb-2">Day pass packs</h2>
            <p className="text-xs text-stone-600 mb-2">
              Banked days for Passes (5- / 10-day packs). Members activate one calendar day at a time from My Membership.
            </p>
            {(() => {
              const todayY = (data?.today_ymd ?? "").trim();
              const packs =
                data?.subscriptions?.filter(
                  (s) => s.pass_credits_remaining != null && String(s.status ?? "") !== "Cancelled"
                ) ?? [];
              if (packs.length === 0) {
                return <p className="text-sm text-stone-500">No day pass packs on file.</p>;
              }
              return (
                <ul className="space-y-2 text-sm text-stone-700">
                  {packs.map((s, i) => {
                    const left = Number(s.pass_credits_remaining ?? 0);
                    const act = String(s.pass_activation_day ?? "").trim();
                    const activeToday = !!todayY && act === todayY;
                    return (
                      <li key={i} className="rounded-lg border border-stone-200 bg-white/80 px-3 py-2">
                        <span className="font-medium text-stone-800">{String(s.plan_name ?? "Pass pack")}</span>
                        <span className="text-stone-600">
                          {" "}
                          — {left} day{left !== 1 ? "s" : ""} left
                        </span>
                        {activeToday && (
                          <span className="ml-2 text-emerald-700 font-medium">· Active today</span>
                        )}
                        {!activeToday && act && (
                          <span className="block text-xs text-stone-500 mt-0.5">Last activated: {act}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </div>

          <div className="pt-4 border-t border-stone-200/80">
            <h2 className="text-base font-semibold text-stone-800 mb-2">PT credits</h2>
            <p className="text-xs text-stone-600 mb-3">
              Balances used when booking PT by session length. Grant one-off credits here (e.g. after a purchase that didn&apos;t record correctly).
            </p>
            {ptCreditBalances === null ? (
              <p className="text-sm text-stone-500">Loading balances…</p>
            ) : (
              <>
                <div className="text-sm text-stone-700 mb-3">
                  {Object.entries(ptCreditBalances).filter(([, n]) => n > 0).length === 0 ? (
                    <span className="text-stone-500">No PT credits on file.</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {Object.entries(ptCreditBalances)
                        .filter(([, n]) => n > 0)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([mins, n]) => (
                          <li key={mins}>
                            <strong>{n}</strong> × {mins}-minute session{Number(n) !== 1 ? "s" : ""}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Session length (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={ptGrantDuration}
                      onChange={(e) => setPtGrantDuration(e.target.value)}
                      placeholder="e.g. 90"
                      className="w-28 px-2 py-1.5 rounded border border-stone-200 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Credits to add</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={ptGrantAmount}
                      onChange={(e) => setPtGrantAmount(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))}
                      className="w-20 px-2 py-1.5 rounded border border-stone-200 text-sm"
                    />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-stone-500 mb-1">Note (optional)</label>
                    <input
                      type="text"
                      value={ptGrantNote}
                      onChange={(e) => setPtGrantNote(e.target.value)}
                      placeholder="e.g. Fitness assessment purchase Mar 2026"
                      className="w-full px-2 py-1.5 rounded border border-stone-200 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={grantPtCredits}
                    disabled={ptGrantSubmitting || ptCreditBalances === null}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {ptGrantSubmitting ? "Saving…" : "Grant credits"}
                  </button>
                </div>
                {ptGrantMessage && (
                  <p className={`mt-3 text-sm ${ptGrantMessage.startsWith("Granted") ? "text-emerald-700" : "text-amber-700"}`}>
                    {ptGrantMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden mb-8">
        <div className="p-6 border-b border-stone-100 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">{displayHeading}</h1>
            {String(member.preferred_name ?? "").trim() ? (
              <p className="text-sm text-stone-500 mt-0.5">Legal name: {legalName}</p>
            ) : null}
            <p className="text-stone-500 mt-1 font-mono text-sm">{member.member_id as string}</p>
            <p className="text-stone-600 text-sm mt-2">
              Auto-renew:{" "}
              <span className="font-semibold text-stone-800">{(member.auto_renew ?? 0) === 1 ? "Yes" : "No"}</span>
              <span className="text-stone-400 font-normal"> — charge saved card when a monthly membership expires</span>
            </p>
            {isAdmin && (
              <span
                className={`mt-2 inline-block px-2.5 py-1 rounded text-xs font-medium ${
                  (member.waiver_signed_at as string)?.trim()
                    ? "bg-green-100 text-green-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {(member.waiver_signed_at as string)?.trim()
                  ? `✓ Waiver signed ${new Date((member.waiver_signed_at as string).trim()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : "Waiver not signed"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Link
              href={`/members/${id}/cart`}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
            >
              Add to cart / Sell
            </Link>
            <button
              type="button"
              onClick={changeCardOnFile}
              disabled={changingCard}
              className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium disabled:opacity-50"
            >
              {changingCard ? "Redirecting…" : "Change payment method"}
            </button>
            <button
              type="button"
              onClick={handleUnlock}
              disabled={unlocking || !canUnlockDoor}
              title={
                !memberEmail
                  ? "Add an email on this profile to use door unlock."
                  : !hasDoorAccess
                    ? "No active membership or day pass activated for today — nothing to open the door for yet."
                    : "Trigger a door unlock for this member (Kisi)."
              }
              className={
                canUnlockDoor
                  ? "px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
                  : "px-4 py-2 rounded-lg border border-stone-200 bg-stone-100 text-stone-500 cursor-not-allowed font-medium"
              }
            >
              {unlocking
                ? "Unlocking…"
                : !memberEmail
                  ? "Unlock door"
                  : !hasDoorAccess
                    ? "No door access"
                    : "Unlock door"}
            </button>
            {unlockMessage && (
              <span className="text-sm text-stone-600">{unlockMessage}</span>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={handleSendWaiver}
                disabled={sendingWaiver}
                className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium disabled:opacity-50"
                title="Send liability waiver link (resets signed state for testing)"
              >
                {sendingWaiver ? "Sending…" : "Send waiver link"}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={sendingPasswordReset}
                className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium disabled:opacity-50"
                title="Same email as Forgot password: 24-hour link to choose a new password"
              >
                {sendingPasswordReset ? "Sending…" : "Send password reset email"}
              </button>
            )}
            {passwordResetMessage && (
              <span className="text-sm text-stone-600 max-w-md">{passwordResetMessage}</span>
            )}
            {waiverResult && (
              <span className="text-sm text-stone-600">
                {waiverResult.message}
                {waiverResult.url && (
                  <a href={waiverResult.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-brand-600 hover:underline">
                    Open waiver link
                  </a>
                )}
              </span>
            )}
            {editing ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (data?.member) setEditForm(buildMemberEditForm(data.member as Record<string, unknown>));
                    setEditing(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="p-6">
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">First name</label>
                <input
                  value={editForm.first_name ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Last name</label>
                <input
                  value={editForm.last_name ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-stone-600 mb-1">Email (required for login & Kisi)</label>
                <input
                  type="email"
                  value={editForm.email ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-stone-600 mb-1">Phone (optional)</label>
                <input
                  type="tel"
                  value={editForm.phone ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. (808) 555-1234"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Role</label>
                <select
                  value={editForm.role ?? "Member"}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                >
                  <option value="Member">Member</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Join date</label>
                <input
                  value={editForm.join_date ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, join_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Renewal date</label>
                <input
                  value={editForm.exp_next_payment_date ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, exp_next_payment_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
              </div>
              <div className="sm:col-span-2 border-t border-stone-100 pt-4 mt-1">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Profile &amp; emergency</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">Preferred name</label>
                    <input
                      value={editForm.preferred_name ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, preferred_name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">Pronouns</label>
                    <input
                      value={editForm.pronouns ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, pronouns: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">Birthday (YYYY-MM-DD)</label>
                    <input
                      type="date"
                      value={editForm.birthday ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, birthday: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-stone-600 mb-1">Mailing address</label>
                    <textarea
                      value={editForm.mailing_address ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, mailing_address: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">Emergency contact name</label>
                    <input
                      value={editForm.emergency_contact_name ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, emergency_contact_name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">Emergency contact phone</label>
                    <input
                      type="tel"
                      value={editForm.emergency_contact_phone ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-stone-600 mb-1">Medical notes / allergies</label>
                    <textarea
                      value={editForm.emergency_info ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, emergency_info: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-stone-600 mb-1">Spirit animal</label>
                    <input
                      value={editForm.spirit_animal ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, spirit_animal: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><dt className="text-stone-500">Email</dt><dd className="font-medium">{String(member.email ?? "—")}</dd></div>
              <div><dt className="text-stone-500">Phone</dt><dd className="font-medium">{String(member.phone ?? "—")}</dd></div>
              <div><dt className="text-stone-500">Role</dt><dd><span className={`px-2 py-0.5 rounded text-xs font-medium ${member.role === "Admin" ? "bg-brand-100 text-brand-800" : "bg-stone-100"}`}>{String(member.role ?? "—")}</span></dd></div>
              <div><dt className="text-stone-500">Join date</dt><dd className="font-medium">{String(member.join_date ?? "—")}</dd></div>
              <div><dt className="text-stone-500">Renewal date</dt><dd className="font-medium">{String(member.exp_next_payment_date ?? "—")}</dd></div>
              <div className="sm:col-span-2 border-t border-stone-100 pt-3 mt-1">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Profile &amp; emergency</p>
              </div>
              <div>
                <dt className="text-stone-500">Preferred name</dt>
                <dd className="font-medium">{String(member.preferred_name ?? "").trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Pronouns</dt>
                <dd className="font-medium">{String(member.pronouns ?? "").trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Birthday</dt>
                <dd className="font-medium">
                  {(() => {
                    const t = String(member.birthday ?? "").trim();
                    if (!t) return "—";
                    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
                      return new Date(`${t}T12:00:00`).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      });
                    }
                    return t;
                  })()}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-stone-500">Mailing address</dt>
                <dd className="font-medium whitespace-pre-wrap">{String(member.mailing_address ?? "").trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Emergency contact</dt>
                <dd className="font-medium">{String(member.emergency_contact_name ?? "").trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Emergency phone</dt>
                <dd className="font-medium">{String(member.emergency_contact_phone ?? "").trim() || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-stone-500">Medical notes / allergies</dt>
                <dd className="font-medium whitespace-pre-wrap">{String(member.emergency_info ?? "").trim() || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-stone-500">Spirit animal</dt>
                <dd className="font-medium">{String(member.spirit_animal ?? "").trim() || "—"}</dd>
              </div>
              {isAdmin && (
                <div>
                  <dt className="text-stone-500">Waiver</dt>
                  <dd className="font-medium">
                    {(member.waiver_signed_at as string)?.trim()
                      ? `Signed ${new Date((member.waiver_signed_at as string).trim()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                      : "Not signed"}
                  </dd>
                </div>
              )}
              {isAdmin && (
                <div className="sm:col-span-2">
                  <dt className="text-stone-500">Stripe customer ID</dt>
                  <dd className="font-mono text-xs break-all text-stone-800 mt-0.5">
                    {(member.stripe_customer_id as string | null | undefined)?.toString().trim() ? (
                      <a
                        href={`https://dashboard.stripe.com/customers/${encodeURIComponent(String(member.stripe_customer_id).trim())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 hover:underline"
                      >
                        {String(member.stripe_customer_id).trim()}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>

      {isAdmin && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-3">Recent unlocks</h2>
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            {unlocks.length === 0 ? (
              <p className="p-6 text-stone-500 text-sm">No door events on file for this member yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-stone-50 text-stone-500">
                    <th className="py-2 px-4">Time</th>
                    <th className="py-2 px-4">Door</th>
                    <th className="py-2 px-4">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {unlocks.map((u) => (
                    <tr key={u.id} className="border-t border-stone-100">
                      <td className="py-2 px-4 whitespace-nowrap">
                        {formatDateTimeInAppTz(new Date(u.happened_at), undefined, tz)}
                      </td>
                      <td className="py-2 px-4">{u.lock_name ?? u.lock_id ?? "—"}</td>
                      <td className="py-2 px-4">{u.success ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <h2 className="text-lg font-semibold text-stone-800">Subscriptions</h2>
          {isAdmin && data.subscriptions.some((s) => s.status === "Active") && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(data.member?.auto_renew ?? 0) === 1}
                onChange={async (e) => {
                  const nextEnabled = e.target.checked;
                  const ok = window.confirm(
                    nextEnabled
                      ? "Turn ON auto-renewal for this member? Their saved card will be charged when their monthly membership expires."
                      : "Turn OFF auto-renewal? They will not be charged automatically when their membership expires."
                  );
                  if (!ok) return;
                  setTogglingAutoRenew(true);
                  try {
                    const res = await fetch(`/api/members/${id}/auto-renew`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ enabled: nextEnabled }),
                    });
                    const json = await res.json();
                    if (json.ok) {
                      setData((d) =>
                        d && d.member ? { ...d, member: { ...d.member, auto_renew: json.auto_renew ? 1 : 0 } } : d
                      );
                    } else {
                      window.alert(json.error ?? "Could not update auto-renew.");
                    }
                  } finally {
                    setTogglingAutoRenew(false);
                  }
                }}
                disabled={togglingAutoRenew}
                className="rounded border-stone-300 text-brand-600"
              />
              <span className="text-stone-600">Opt-in for auto-renewal (charge saved card when membership expires)</span>
            </label>
          )}
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          {data.subscriptions.length === 0 ? (
            <p className="p-6 text-stone-500 text-sm">No subscriptions.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-stone-50 text-stone-500"><th className="py-2 px-4">Plan</th><th className="py-2 px-4">Status</th><th className="py-2 px-4">Start</th><th className="py-2 px-4">Expiry</th><th className="py-2 px-4">Days left</th><th className="py-2 px-4">Admin</th></tr></thead>
              <tbody>
                {data.subscriptions.map((s, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(s.plan_name ?? s.product_id ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.status ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.start_date ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.expiry_date ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.days_remaining ?? "—")}</td>
                    <td className="py-2 px-4">
                      {isAdmin && s.status !== "Cancelled" ? (
                        <button type="button" onClick={() => cancelSubscription(String(s.subscription_id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">
                          {adminAction === "sub" ? "…" : "Cancel"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">Class bookings</h2>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          {data.classBookings.length === 0 ? (
            <p className="p-6 text-stone-500 text-sm">No class bookings.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-stone-50 text-stone-500"><th className="py-2 px-4">Class</th><th className="py-2 px-4">Date</th><th className="py-2 px-4">Payment</th></tr></thead>
              <tbody>
                {data.classBookings.map((b, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.class_name ?? b.product_id ?? "—")}</td>
                    <td className="py-2 px-4">{String(b.booking_date ?? "—")}</td>
                    <td className="py-2 px-4">{String(b.payment_status ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">PT bookings</h2>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          {(data.ptBookings?.length ?? 0) + (data.ptSlotBookings?.length ?? 0) + (data.ptTrainerSpecificBookings?.length ?? 0) + (data.ptOpenBookings?.length ?? 0) === 0 ? (
            <p className="p-6 text-stone-500 text-sm">No PT bookings.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-stone-50 text-stone-500"><th className="py-2 px-4">Session</th><th className="py-2 px-4">Date</th><th className="py-2 px-4">Payment</th><th className="py-2 px-4">Admin</th></tr></thead>
              <tbody>
                {data.ptBookings?.map((b, i) => (
                  <tr key={`legacy-${i}`} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.session_name ?? b.product_id ?? "—")}</td>
                    <td className="py-2 px-4">{String(b.booking_date ?? "—")}</td>
                    <td className="py-2 px-4">{String(b.payment_status ?? "—")}</td>
                    <td className="py-2 px-4">—</td>
                  </tr>
                ))}
                {(data.ptSlotBookings ?? []).map((b) => (
                  <tr key={`slot-${b.id}`} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.session_name ?? "PT slot")}</td>
                    <td className="py-2 px-4">{String(b.session_date ?? "—")}</td>
                    <td className="py-2 px-4">—</td>
                    <td className="py-2 px-4">
                      {isAdmin ? (
                        <button type="button" onClick={() => cancelPTBooking("slot", Number(b.id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">Cancel</button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {(data.ptTrainerSpecificBookings ?? []).map((b) => (
                  <tr key={`block-${b.id}`} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.trainer ?? "—")} PT ({String(b.session_duration_minutes ?? "")} min)</td>
                    <td className="py-2 px-4">{String(b.occurrence_date ?? "—")} {String(b.start_time ?? "")}</td>
                    <td className="py-2 px-4">{String(b.payment_type ?? "—")}</td>
                    <td className="py-2 px-4">
                      {isAdmin ? (
                        <button type="button" onClick={() => cancelPTBooking("trainer_specific", Number(b.id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">Cancel</button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {(data.ptOpenBookings ?? []).map((b) => (
                  <tr key={`open-${b.id}`} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.session_name ?? "—")} ({String(b.duration_minutes ?? "")} min)</td>
                    <td className="py-2 px-4">{String(b.occurrence_date ?? "—")} {String(b.start_time ?? "")}</td>
                    <td className="py-2 px-4">{String(b.payment_type ?? "—")}</td>
                    <td className="py-2 px-4">
                      {isAdmin ? (
                        <button type="button" onClick={() => cancelPTBooking("open", Number(b.id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">Cancel</button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-800 mb-3">Sales / purchase history</h2>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
          {data.sales.length === 0 ? (
            <p className="p-6 text-stone-500 text-sm">No sales yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead><tr className="bg-stone-50 text-stone-500"><th className="py-2 px-4">Sales ID</th><th className="py-2 px-4">Date</th><th className="py-2 px-4">Status</th><th className="py-2 px-4">Total</th><th className="py-2 px-4">Admin</th></tr></thead>
              <tbody>
                {data.sales.map((s, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-2 px-4 font-mono">{String(s.sales_id ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.date_time ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.status ?? "—")}</td>
                    <td className="py-2 px-4">{String(s.grand_total ?? s.price ?? "—")}</td>
                    <td className="py-2 px-4">
                      {isAdmin && s.status !== "Refunded" ? (
                        <button type="button" onClick={() => refundSale(String(s.sales_id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">
                          {adminAction === "refund" ? "…" : "Refund"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
