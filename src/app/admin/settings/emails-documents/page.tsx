"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DocType = "privacy" | "terms" | "gym_waiver";

const DOC_LABELS: Record<DocType, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  gym_waiver: "Gym Liability Waiver",
};

export default function EmailsDocumentsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"documents" | "emails">("documents");

  const [privacyHtml, setPrivacyHtml] = useState("");
  const [termsHtml, setTermsHtml] = useState("");
  const [gymWaiverHtml, setGymWaiverHtml] = useState("");
  const [privacyFile, setPrivacyFile] = useState<string | null>(null);
  const [termsFile, setTermsFile] = useState<string | null>(null);
  const [gymWaiverFile, setGymWaiverFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState<DocType | null>(null);

  const [emailPostPurchaseSubject, setEmailPostPurchaseSubject] = useState("");
  const [emailPostPurchaseBody, setEmailPostPurchaseBody] = useState("");
  const [emailMembershipExpirySubject, setEmailMembershipExpirySubject] = useState("");
  const [emailMembershipExpiryBody, setEmailMembershipExpiryBody] = useState("");
  const [emailMoneyOwedReminderSubject, setEmailMoneyOwedReminderSubject] = useState("");
  const [emailMoneyOwedReminderBody, setEmailMoneyOwedReminderBody] = useState("");
  const [emailAppDownloadSubject, setEmailAppDownloadSubject] = useState("");
  const [emailAppDownloadBody, setEmailAppDownloadBody] = useState("");
  const [emailLiabilityWaiverSubject, setEmailLiabilityWaiverSubject] = useState("");
  const [emailLiabilityWaiverBody, setEmailLiabilityWaiverBody] = useState("");
  const [emailBookingConfirmationSubject, setEmailBookingConfirmationSubject] = useState("");
  const [emailBookingConfirmationBody, setEmailBookingConfirmationBody] = useState("");
  const [emailBookingTrainerAssignedSubject, setEmailBookingTrainerAssignedSubject] = useState("");
  const [emailBookingTrainerAssignedBody, setEmailBookingTrainerAssignedBody] = useState("");
  const [defaults, setDefaults] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/settings/emails-documents")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, string | null> & { defaults?: Record<string, string> } | null) => {
        if (data) {
          setDefaults(data.defaults ?? {});
          setPrivacyHtml(data.document_privacy_html ?? "");
          setTermsHtml(data.document_terms_html ?? "");
          setGymWaiverHtml(data.document_gym_waiver_html ?? "");
          setPrivacyFile(data.document_privacy_file ?? null);
          setTermsFile(data.document_terms_file ?? null);
          setGymWaiverFile(data.document_gym_waiver_file ?? null);
          setEmailPostPurchaseSubject(data.email_post_purchase_subject ?? "");
          setEmailPostPurchaseBody(data.email_post_purchase_body ?? "");
          setEmailMembershipExpirySubject(data.email_membership_expiry_subject ?? "");
          setEmailMembershipExpiryBody(data.email_membership_expiry_body ?? "");
          setEmailMoneyOwedReminderSubject(data.email_money_owed_reminder_subject ?? "");
          setEmailMoneyOwedReminderBody(data.email_money_owed_reminder_body ?? "");
          setEmailAppDownloadSubject(data.email_app_download_subject ?? "");
          setEmailAppDownloadBody(data.email_app_download_body ?? "");
          setEmailLiabilityWaiverSubject(data.email_liability_waiver_subject ?? "");
          setEmailLiabilityWaiverBody(data.email_liability_waiver_body ?? "");
          setEmailBookingConfirmationSubject(data.email_booking_confirmation_subject ?? "");
          setEmailBookingConfirmationBody(data.email_booking_confirmation_body ?? "");
          setEmailBookingTrainerAssignedSubject(data.email_booking_trainer_assigned_subject ?? "");
          setEmailBookingTrainerAssignedBody(data.email_booking_trainer_assigned_body ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/emails-documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_privacy_html: privacyHtml || null,
          document_terms_html: termsHtml || null,
          document_gym_waiver_html: gymWaiverHtml || null,
          document_privacy_file: privacyFile || null,
          document_terms_file: termsFile || null,
          document_gym_waiver_file: gymWaiverFile || null,
          email_post_purchase_subject: emailPostPurchaseSubject || null,
          email_post_purchase_body: emailPostPurchaseBody || null,
          email_membership_expiry_subject: emailMembershipExpirySubject || null,
          email_membership_expiry_body: emailMembershipExpiryBody || null,
          email_money_owed_reminder_subject: emailMoneyOwedReminderSubject || null,
          email_money_owed_reminder_body: emailMoneyOwedReminderBody || null,
          email_app_download_subject: emailAppDownloadSubject || null,
          email_app_download_body: emailAppDownloadBody || null,
          email_liability_waiver_subject: emailLiabilityWaiverSubject || null,
          email_liability_waiver_body: emailLiabilityWaiverBody || null,
          email_booking_confirmation_subject: emailBookingConfirmationSubject || null,
          email_booking_confirmation_body: emailBookingConfirmationBody || null,
          email_booking_trainer_assigned_subject: emailBookingTrainerAssignedSubject || null,
          email_booking_trainer_assigned_body: emailBookingTrainerAssignedBody || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Failed to save." });
        return;
      }
      setMessage({ type: "ok", text: "Settings saved." });
    } catch {
      setMessage({ type: "err", text: "Something went wrong." });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(type: DocType, file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setMessage({ type: "err", text: "Only PDF files are supported." });
      return;
    }
    setMessage(null);
    setUploading(type);
    try {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("file", file);
      const res = await fetch("/api/admin/upload-document", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Upload failed." });
        return;
      }
      if (type === "privacy") setPrivacyFile(data.filename ?? "privacy.pdf");
      if (type === "terms") setTermsFile(data.filename ?? "terms.pdf");
      if (type === "gym_waiver") setGymWaiverFile(data.filename ?? "gym_waiver.pdf");
      setMessage({ type: "ok", text: "File uploaded. Click Save to apply." });
    } catch {
      setMessage({ type: "err", text: "Upload failed." });
    } finally {
      setUploading(null);
    }
  }

  function DocSection({
    type,
    html,
    setHtml,
    file,
    setFile,
  }: {
    type: DocType;
    html: string;
    setHtml: (v: string) => void;
    file: string | null;
    setFile: (v: string | null) => void;
  }) {
    return (
      <div className="border border-stone-200 rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-stone-800">{DOC_LABELS[type]}</h3>
        <p className="text-sm text-stone-500">
          Paste HTML or plain text below, or upload a PDF. If both are set, the uploaded PDF is used when available.
        </p>
        {defaults[`document_${type}_default`] && (
          <p className="text-sm text-stone-600 bg-stone-50 rounded-lg px-3 py-2 border border-stone-100">
            <strong>Default when empty:</strong> {defaults[`document_${type}_default`]}
          </p>
        )}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Text content (paste here)</label>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
            placeholder="Paste your document content here..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Or upload PDF</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="file"
              accept=".pdf"
              className="text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(type, f);
                e.target.value = "";
              }}
              disabled={!!uploading}
            />
            {file && (
              <span className="text-sm text-stone-600">
                Current: {file}{" "}
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-red-600 hover:underline"
                >
                  Clear
                </button>
              </span>
            )}
            {uploading === type && <span className="text-sm text-stone-500">Uploading…</span>}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">
          ← Back to Settings
        </Link>
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <Link href="/admin/settings" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Emails & Documents</h1>
        <p className="text-stone-500 mt-1">
          Edit automatic emails and waiver documents. Use placeholders like {"{{first_name}}"}, {"{{member_id}}"}, {"{{waiver_url}}"} in emails.
        </p>
      </header>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        <button
          type="button"
          onClick={() => setActiveTab("documents")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "documents" ? "border-brand-600 text-brand-600" : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          Documents (Waivers)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("emails")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "emails" ? "border-brand-600 text-brand-600" : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          Email Templates
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {activeTab === "documents" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-stone-800">Waiver Documents</h2>
            <p className="text-sm text-stone-500">
              Privacy Policy and Terms of Service are shown at signup and on the waiver page. The gym waiver is shown when members sign before door access.
            </p>
            <DocSection type="privacy" html={privacyHtml} setHtml={setPrivacyHtml} file={privacyFile} setFile={setPrivacyFile} />
            <DocSection type="terms" html={termsHtml} setHtml={setTermsHtml} file={termsFile} setFile={setTermsFile} />
            <DocSection type="gym_waiver" html={gymWaiverHtml} setHtml={setGymWaiverHtml} file={gymWaiverFile} setFile={setGymWaiverFile} />
          </section>
        )}

        {activeTab === "emails" && (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-stone-800">Email Templates</h2>
            <p className="text-sm text-stone-500">
              Placeholders: {"{{first_name}}"}, {"{{member_id}}"}, {"{{email}}"}, {"{{origin}}"}, {"{{install_url}}"}, {"{{set_password_url}}"}, {"{{expiry_date}}"}, {"{{waiver_url}}"}, {"{{card_message}}"} (membership expiry), and for booking emails: {"{{session_title}}"}, {"{{kind_label}}"}, {"{{date}}"}, {"{{time}}"}, {"{{trainer}}"}, {"{{brand_short}}"}, {"{{brand_name}}"}.
            </p>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Post-purchase / Welcome</h3>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailPostPurchaseSubject}
                  onChange={(e) => setEmailPostPurchaseSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_post_purchase_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_post_purchase_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailPostPurchaseBody}
                  onChange={(e) => setEmailPostPurchaseBody(e.target.value)}
                  rows={8}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_post_purchase_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_post_purchase_body}</pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Membership expiring soon</h3>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailMembershipExpirySubject}
                  onChange={(e) => setEmailMembershipExpirySubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_membership_expiry_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_membership_expiry_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body (use {"{{card_message}}"} for card-on-file vs payment-due paragraph)</label>
                <textarea
                  value={emailMembershipExpiryBody}
                  onChange={(e) => setEmailMembershipExpiryBody(e.target.value)}
                  rows={8}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_membership_expiry_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_membership_expiry_body}</pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Money owed reminder</h3>
              <p className="text-sm text-stone-500">
                Sent when staff taps <strong>Send email reminder</strong> on{" "}
                <Link href="/money-owed" className="text-brand-600 hover:underline">
                  Money owed
                </Link>
                . Placeholders:{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">{"{{first_name}}"}</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">{"{{member_name}}"}</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">{"{{plan_name}}"}</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">{"{{amount_formatted}}"}</code>,{" "}
                <code className="text-xs bg-stone-100 px-1 rounded">{"{{pay_url}}"}</code> (sign in, then Membership page to update card).
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailMoneyOwedReminderSubject}
                  onChange={(e) => setEmailMoneyOwedReminderSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_money_owed_reminder_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_money_owed_reminder_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailMoneyOwedReminderBody}
                  onChange={(e) => setEmailMoneyOwedReminderBody(e.target.value)}
                  rows={10}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_money_owed_reminder_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">
                      {defaults.email_money_owed_reminder_body}
                    </pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">App download invite</h3>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailAppDownloadSubject}
                  onChange={(e) => setEmailAppDownloadSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_app_download_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_app_download_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailAppDownloadBody}
                  onChange={(e) => setEmailAppDownloadBody(e.target.value)}
                  rows={14}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_app_download_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_app_download_body}</pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Booking confirmation (class &amp; PT)</h3>
              <p className="text-sm text-stone-500">
                Sent when a member books. Trainer may show as TBD for open PT slots until staff assigns someone.
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailBookingConfirmationSubject}
                  onChange={(e) => setEmailBookingConfirmationSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_booking_confirmation_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_booking_confirmation_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailBookingConfirmationBody}
                  onChange={(e) => setEmailBookingConfirmationBody(e.target.value)}
                  rows={10}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_booking_confirmation_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_booking_confirmation_body}</pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Trainer assigned (open PT follow-up)</h3>
              <p className="text-sm text-stone-500">
                Sent when staff assigns a trainer to an open PT booking the member already holds. If you leave these blank, the booking confirmation template above is used.
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailBookingTrainerAssignedSubject}
                  onChange={(e) => setEmailBookingTrainerAssignedSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_booking_trainer_assigned_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_booking_trainer_assigned_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailBookingTrainerAssignedBody}
                  onChange={(e) => setEmailBookingTrainerAssignedBody(e.target.value)}
                  rows={10}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_booking_trainer_assigned_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_booking_trainer_assigned_body}</pre>
                  </details>
                )}
              </div>
            </div>

            <div className="border border-stone-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-stone-800">Liability waiver link</h3>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={emailLiabilityWaiverSubject}
                  onChange={(e) => setEmailLiabilityWaiverSubject(e.target.value)}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                />
                {defaults.email_liability_waiver_subject && (
                  <p className="mt-1 text-xs text-stone-500">Default: {defaults.email_liability_waiver_subject}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Body</label>
                <textarea
                  value={emailLiabilityWaiverBody}
                  onChange={(e) => setEmailLiabilityWaiverBody(e.target.value)}
                  rows={6}
                  placeholder="Leave blank to use default"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 font-mono text-sm"
                />
                {defaults.email_liability_waiver_body && (
                  <details className="mt-2">
                    <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-700">Show default body</summary>
                    <pre className="mt-1 p-3 rounded-lg bg-stone-50 border border-stone-100 text-xs text-stone-600 overflow-x-auto whitespace-pre-wrap font-mono">{defaults.email_liability_waiver_body}</pre>
                  </details>
                )}
              </div>
            </div>
          </section>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {message && (
            <p className={`text-sm ${message.type === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
          )}
        </div>
      </form>
    </div>
  );
}
