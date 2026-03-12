"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type TrainerData = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  waiver_agreed_at: string;
  form_1099_received_at: string;
  form_i9_received_at: string;
  exempt_from_tax_forms: number;
};

export default function EditTrainerPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string)?.trim() || "";
  const [data, setData] = useState<TrainerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [waiverAgreedAt, setWaiverAgreedAt] = useState("");
  const [form1099At, setForm1099At] = useState("");
  const [formI9At, setFormI9At] = useState("");
  const [exemptFromTaxForms, setExemptFromTaxForms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    fetch(`/api/admin/trainers/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Trainer not found" : "Failed to load");
        return r.json();
      })
      .then((d: TrainerData) => {
        setData(d);
        setWaiverAgreedAt(d.waiver_agreed_at ?? "");
        setForm1099At(d.form_1099_received_at ?? "");
        setFormI9At(d.form_i9_received_at ?? "");
        setExemptFromTaxForms(!!d.exempt_from_tax_forms);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const displayName = data ? [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || data.member_id : "";
  const isAdmin = data?.role === "Admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/trainers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waiver_agreed_at: waiverAgreedAt.trim() || "",
          form_1099_received_at: exemptFromTaxForms || isAdmin ? "" : form1099At.trim(),
          form_i9_received_at: exemptFromTaxForms || isAdmin ? "" : formI9At.trim(),
          exempt_from_tax_forms: exemptFromTaxForms || isAdmin ? 1 : 0,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        router.push(`/admin/trainers?trainer=${id}`);
      } else {
        setError(result.error ?? "Failed to update");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-stone-500">Loading…</div>;
  if (error && !data) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Edit trainer</h1>
      <p className="text-sm text-stone-600 mb-6">
        Update document dates for {displayName}.
      </p>
      <Link href={`/admin/trainers?trainer=${id}`} className="text-brand-600 hover:underline text-sm mb-6 inline-block">
        ← {displayName}&apos;s schedule
      </Link>

      <form onSubmit={handleSubmit} className="space-y-6 p-4 rounded-xl border border-stone-200 bg-white">
        <div>
          <p className="text-sm text-stone-600">
            <strong>{displayName}</strong> {data.email ? `(${data.email})` : ""} {isAdmin ? "— Admin" : ""}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-stone-800 mb-2">Documents</h3>
          {isAdmin && (
            <p className="mb-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
              This member is an admin; 1099 and I-9 are not required.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Waiver agreed (date)</label>
              <input
                type="date"
                value={waiverAgreedAt}
                onChange={(e) => setWaiverAgreedAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-200"
              />
            </div>
            {!isAdmin && (
              <>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">1099 received (date)</label>
                  <input
                    type="date"
                    value={form1099At}
                    onChange={(e) => setForm1099At(e.target.value)}
                    disabled={exemptFromTaxForms}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">I-9 received (date)</label>
                  <input
                    type="date"
                    value={formI9At}
                    onChange={(e) => setFormI9At(e.target.value)}
                    disabled={exemptFromTaxForms}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 disabled:opacity-50"
                  />
                </div>
              </>
            )}
          </div>
          {!isAdmin && (
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={exemptFromTaxForms}
                onChange={(e) => setExemptFromTaxForms(e.target.checked)}
              />
              <span className="text-sm text-stone-700">Exempt from tax forms (1099/I-9)</span>
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
