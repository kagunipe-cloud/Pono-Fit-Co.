"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const MIN_PASSWORD_LENGTH = 8;

type ProfilePayload = {
  member_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  email: string;
  phone: string;
  pronouns: string;
  birthday: string;
  mailing_address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_info: string;
  spirit_animal: string;
  has_password: boolean;
};

export default function MemberProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const [form, setForm] = useState<ProfilePayload | null>(null);
  const [ptCredits, setPtCredits] = useState<Record<number, number>>({});
  const [classCredits, setClassCredits] = useState<number | null>(null);
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    fetch("/api/member/profile")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.error) {
          setError(data.error);
          return;
        }
        if (data?.member_id) setForm(data as ProfilePayload);
      })
      .catch(() => setError("Could not load profile."))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    Promise.all([
      fetch("/api/member/pt-credits").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/member/class-credits").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([pt, cc]) => {
        if (pt && typeof pt === "object" && !("error" in pt)) {
          setPtCredits(pt as Record<number, number>);
        }
        if (cc && typeof cc === "object" && typeof (cc as { balance?: number }).balance === "number") {
          setClassCredits((cc as { balance: number }).balance);
        } else {
          setClassCredits(0);
        }
      })
      .catch(() => {
        setPtCredits({});
        setClassCredits(0);
      })
      .finally(() => setCreditsLoaded(true));
  }, []);

  function updateField<K extends keyof ProfilePayload>(key: K, value: ProfilePayload[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSuccess(null);
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("First name and last name are required.");
      return;
    }
    if (!form.email.trim()) {
      setError("Email is required.");
      return;
    }
    setSaving(true);
    try {
      const patchBody = { ...form };
      delete (patchBody as { has_password?: boolean }).has_password;
      const res = await fetch("/api/member/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Save failed.");
        return;
      }
      setSuccess("Profile saved.");
      window.dispatchEvent(new Event("member-me-refresh"));
      router.refresh();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPwError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/member/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(json.error ?? "Could not update password.");
        return;
      }
      setPwSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (form) setForm({ ...form, has_password: true });
    } catch {
      setPwError("Could not update password.");
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) {
    return <div className="max-w-xl mx-auto p-6 text-center text-stone-500">Loading…</div>;
  }
  if (!form) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center text-stone-600">
        {error ?? "Unable to load profile."}
        <div className="mt-4">
          <Link href="/member" className="text-brand-600 font-medium">
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6 pb-16">
      <div className="mb-6">
        <Link href="/member" className="text-sm text-brand-600 hover:underline font-medium">
          ← Member home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800 mt-2">Your profile</h1>
        <p className="text-sm text-stone-500 mt-1">
          Update how we reach you, who to call in an emergency, and a little fun.
        </p>
      </div>

      <section className="mb-8 rounded-xl border border-stone-200 bg-stone-50/80 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-stone-800 mb-2">My credits</h2>
        {!creditsLoaded ? (
          <p className="text-sm text-stone-500">Loading credits…</p>
        ) : (
          <div className="space-y-3 text-sm text-stone-700">
            <div>
              <span className="font-medium text-stone-800">PT session credits</span>
              {Object.entries(ptCredits).filter(([, n]) => n > 0).length === 0 ? (
                <p className="mt-1 text-stone-600">None right now. Purchase a PT pack or single session to book training.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {Object.entries(ptCredits)
                    .filter(([, n]) => n > 0)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([mins, count]) => (
                      <li key={mins}>
                        <strong>{count}</strong> × {mins}-minute session{Number(count) !== 1 ? "s" : ""}
                      </li>
                    ))}
                </ul>
              )}
              <p className="mt-2">
                <Link href="/member/book-pt" className="text-brand-600 font-medium hover:underline">
                  Book PT
                </Link>
                {" · "}
                <Link href="/member/pt-packs" className="text-brand-600 font-medium hover:underline">
                  PT packs
                </Link>
              </p>
            </div>
            <div className="pt-3 border-t border-stone-200">
              <span className="font-medium text-stone-800">Class credits</span>
              <p className="mt-1 text-stone-600">
                {classCredits != null && classCredits > 0 ? (
                  <>
                    <strong>{classCredits}</strong> credit{classCredits !== 1 ? "s" : ""} for recurring classes.
                  </>
                ) : (
                  <>None right now.</>
                )}
              </p>
              <p className="mt-2">
                <Link href="/member/book-classes" className="text-brand-600 font-medium hover:underline">
                  Book a class
                </Link>
                {" · "}
                <Link href="/member/class-packs" className="text-brand-600 font-medium hover:underline">
                  Class packs
                </Link>
              </p>
            </div>
          </div>
        )}
      </section>

      <form onSubmit={handleSaveProfile} className="space-y-8">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {success}
          </div>
        )}

        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800 mb-3">Name &amp; contact</h2>
          <p className="text-xs text-stone-500 mb-4">
            <span className="text-stone-700 font-medium">Required:</span> first name, last name, and email only.
            All other fields on this page are optional. Your email is your login; we also use it for receipts and reminders.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-stone-600">First name</span>
              <input
                required
                value={form.first_name}
                onChange={(e) => updateField("first_name", e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                autoComplete="given-name"
              />
            </label>
            <label className="block text-sm">
              <span className="text-stone-600">Last name</span>
              <input
                required
                value={form.last_name}
                onChange={(e) => updateField("last_name", e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                autoComplete="family-name"
              />
            </label>
          </div>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Preferred name (optional)</span>
            <input
              value={form.preferred_name}
              onChange={(e) => updateField("preferred_name", e.target.value)}
              placeholder="What you like to be called"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
              autoComplete="nickname"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
              autoComplete="email"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Phone (optional)</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
              autoComplete="tel"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Pronouns (optional)</span>
            <input
              value={form.pronouns}
              onChange={(e) => updateField("pronouns", e.target.value)}
              placeholder="e.g. she/her, he/him, they/them"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Birthday (optional)</span>
            <input
              type="date"
              value={form.birthday}
              onChange={(e) => updateField("birthday", e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Mailing address (optional)</span>
            <textarea
              value={form.mailing_address}
              onChange={(e) => updateField("mailing_address", e.target.value)}
              rows={2}
              placeholder="Street, city, ZIP"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900 resize-y"
            />
          </label>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800 mb-1">Emergency</h2>
          <p className="text-xs text-stone-500 mb-4">
            Helps staff support you if something happens during a visit. Optional but recommended.
          </p>
          <label className="block text-sm">
            <span className="text-stone-600">Emergency contact name</span>
            <input
              value={form.emergency_contact_name}
              onChange={(e) => updateField("emergency_contact_name", e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
              autoComplete="name"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Emergency contact phone</span>
            <input
              type="tel"
              value={form.emergency_contact_phone}
              onChange={(e) => updateField("emergency_contact_phone", e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
              autoComplete="tel"
            />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-stone-600">Medical notes / allergies (optional)</span>
            <textarea
              value={form.emergency_info}
              onChange={(e) => updateField("emergency_info", e.target.value)}
              rows={3}
              placeholder="Anything staff should know in an emergency"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900 resize-y"
            />
          </label>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-800 mb-1">Spirit animal</h2>
          <p className="text-xs text-stone-500 mb-3">Totally optional. We’re not judging. (Okay, maybe a little.)</p>
          <input
            value={form.spirit_animal}
            onChange={(e) => updateField("spirit_animal", e.target.value)}
            placeholder="e.g. honu, manō, owl…"
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
          />
        </section>

        <button
          type="submit"
          data-dumbbell-btn
          disabled={saving}
          className="w-full sm:w-auto px-6 py-2.5 rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      <div className="mt-10 pt-8 border-t border-stone-200">
        <h2 className="text-sm font-semibold text-stone-800 mb-1">Password</h2>
        {form.has_password ? (
          <form onSubmit={handleChangePassword} className="space-y-3 max-w-md">
            {pwError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{pwError}</div>
            )}
            {pwSuccess && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {pwSuccess}
              </div>
            )}
            <label className="block text-sm">
              <span className="text-stone-600">Current password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                autoComplete="current-password"
              />
            </label>
            <label className="block text-sm">
              <span className="text-stone-600">New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                autoComplete="new-password"
              />
            </label>
            <label className="block text-sm">
              <span className="text-stone-600">Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-stone-900"
                autoComplete="new-password"
              />
            </label>
            <button
              type="submit"
              data-dumbbell-btn
              disabled={pwSaving}
              className="px-6 py-2.5 rounded-lg font-medium disabled:opacity-50"
            >
              {pwSaving ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-stone-600">
            You haven’t set a password yet. Use the link from your welcome email, or{" "}
            <Link
              href={`/set-password?member_id=${encodeURIComponent(form.member_id)}&email=${encodeURIComponent(form.email)}`}
              className="text-brand-600 font-medium hover:underline"
            >
              open the set-password page
            </Link>{" "}
            with your member ID and email.
          </p>
        )}
      </div>
    </div>
  );
}
