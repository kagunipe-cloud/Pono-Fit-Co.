"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateForDisplay } from "@/lib/app-timezone";
import { useAppTimezone } from "@/lib/settings-context";
import { BRAND } from "@/lib/branding";

type Lead = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: string | null;
};

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const tz = useAppTimezone();

  useEffect(() => {
    fetch("/api/admin/leads")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLeads(data))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, []);

  function mailtoLink(lead: Lead) {
    const email = lead.email?.trim();
    if (!email) return null;
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
    const subject = encodeURIComponent(`Hi${name ? ` ${name}` : ""} — ${BRAND.name}`);
    return `mailto:${encodeURIComponent(email)}?subject=${subject}`;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to home</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Leads</h1>
      <p className="text-stone-500 text-sm mb-6">
        Members who have signed up but not yet made a purchase. Click the email link to reach out.
      </p>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-stone-500">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            No leads yet. New signups will appear here.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 text-stone-500 text-sm font-medium">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Signed up</th>
                <th className="py-3 px-4 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "—";
                const email = lead.email?.trim() || "—";
                const link = mailtoLink(lead);
                return (
                  <tr key={lead.member_id} className="border-t border-stone-100 hover:bg-brand-50/30">
                    <td className="py-3 px-4 font-medium text-stone-800">{name}</td>
                    <td className="py-3 px-4 text-stone-600">{email}</td>
                    <td className="py-3 px-4 text-stone-600 text-sm">
                      {lead.created_at ? formatDateForDisplay(lead.created_at, tz) : "—"}
                    </td>
                    <td className="py-3 px-4">
                      {link ? (
                        <a
                          href={link}
                          className="text-brand-600 hover:underline text-sm font-medium"
                        >
                          Email
                        </a>
                      ) : (
                        <span className="text-stone-400 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
