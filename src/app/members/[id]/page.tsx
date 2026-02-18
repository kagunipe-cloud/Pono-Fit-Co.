"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

type Member = Record<string, unknown>;
type LinkedRow = Record<string, unknown>;

export default function MemberDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<{
    member: Member;
    subscriptions: LinkedRow[];
    classBookings: LinkedRow[];
    ptBookings: LinkedRow[];
    ptSlotBookings?: LinkedRow[];
    ptBlockBookings?: LinkedRow[];
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
      setEditForm({
        first_name: String(json.member?.first_name ?? ""),
        last_name: String(json.member?.last_name ?? ""),
        email: String(json.member?.email ?? ""),
        role: String(json.member?.role ?? "Member"),
        join_date: String(json.member?.join_date ?? ""),
        exp_next_payment_date: String(json.member?.exp_next_payment_date ?? ""),
      });
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

  async function cancelPTBooking(type: "slot" | "block", id: number) {
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
    setAdminAction("refund");
    try {
      const res = await fetch("/api/admin/sales/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_id: salesId }),
      });
      const json = await res.json();
      if (res.ok) fetchMember();
      else alert(json.error ?? "Failed");
    } finally {
      setAdminAction(null);
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
      if (!res.ok) throw new Error("Failed to update");
      const updated = await res.json();
      setData((d) => (d ? { ...d, member: updated } : null));
      setEditing(false);
    } catch {
      setError("Failed to save");
    }
  }

  if (loading) return <div className="p-12 text-center text-stone-500">Loading…</div>;
  if (error || !data) return <div className="p-12 text-center text-red-600">{error ?? "Not found"}</div>;

  const member = data.member;
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member";

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

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden mb-8">
        <div className="p-6 border-b border-stone-100 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">{name}</h1>
            <p className="text-stone-500 mt-1 font-mono text-sm">{member.member_id as string}</p>
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
              {changingCard ? "Redirecting…" : "Change card on file"}
            </button>
            <button
              type="button"
              onClick={handleUnlock}
              disabled={unlocking || !(member.email as string)}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {unlocking ? "Unlocking…" : "Unlock door"}
            </button>
            {unlockMessage && (
              <span className="text-sm text-stone-600">{unlockMessage}</span>
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
                  onClick={() => setEditing(false)}
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
                <label className="block text-sm font-medium text-stone-600 mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
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
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><dt className="text-stone-500">Email</dt><dd className="font-medium">{String(member.email ?? "—")}</dd></div>
              <div><dt className="text-stone-500">Role</dt><dd><span className={`px-2 py-0.5 rounded text-xs font-medium ${member.role === "Admin" ? "bg-brand-100 text-brand-800" : "bg-stone-100"}`}>{String(member.role ?? "—")}</span></dd></div>
              <div><dt className="text-stone-500">Join date</dt><dd className="font-medium">{String(member.join_date ?? "—")}</dd></div>
              <div><dt className="text-stone-500">Renewal date</dt><dd className="font-medium">{String(member.exp_next_payment_date ?? "—")}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-800 mb-3">Subscriptions</h2>
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
          {(data.ptBookings?.length ?? 0) + (data.ptSlotBookings?.length ?? 0) + (data.ptBlockBookings?.length ?? 0) === 0 ? (
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
                {(data.ptBlockBookings ?? []).map((b) => (
                  <tr key={`block-${b.id}`} className="border-t border-stone-100">
                    <td className="py-2 px-4">{String(b.trainer ?? "—")} PT ({b.session_duration_minutes} min)</td>
                    <td className="py-2 px-4">{String(b.occurrence_date ?? "—")} {String(b.start_time ?? "")}</td>
                    <td className="py-2 px-4">—</td>
                    <td className="py-2 px-4">
                      {isAdmin ? (
                        <button type="button" onClick={() => cancelPTBooking("block", Number(b.id))} disabled={!!adminAction} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">Cancel</button>
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
