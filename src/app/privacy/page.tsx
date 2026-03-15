import { Suspense } from "react";
import { BRAND } from "@/lib/branding";
import { BackLink } from "@/components/BackLink";
import { getDocumentSettings } from "@/lib/documents";

export const metadata = {
  title: `Privacy Policy | ${BRAND.name}`,
  description: `Privacy policy for ${BRAND.name} membership and fitness services.`,
};

function PrivacyDefaultContent() {
  return (
    <div className="prose prose-stone max-w-none space-y-6 text-sm text-stone-700">
        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">1. Introduction</h2>
          <p>
            PBJB LLC, doing business as {BRAND.name} (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;), operates the membership and fitness services at beponofitco.com and related applications. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">2. Information We Collect</h2>
          <p className="mb-2">We collect information you provide directly and information generated through your use of our services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account information:</strong> Name, email address, phone number, and member ID</li>
            <li><strong>Payment information:</strong> Processed by Stripe; we do not store full card numbers or bank account details. We accept credit/debit cards and ACH (bank account) payments for memberships, classes, and personal training. Billing address is collected at checkout for payment processing and tax compliance.</li>
            <li><strong>Membership and booking data:</strong> Subscriptions, class bookings, personal training sessions</li>
            <li><strong>Fitness and nutrition data:</strong> Workout logs, macro tracking, and related information you choose to enter</li>
            <li><strong>Waiver and consent records:</strong> Liability waiver agreements and signatures</li>
            <li><strong>Door access data:</strong> Used to manage facility access via our access control provider (Kisi)</li>
            <li><strong>Communications:</strong> Emails we send and support inquiries</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">3. How We Use Your Information</h2>
          <p className="mb-2">We use your information to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide membership, class booking, and personal training services</li>
            <li>Process payments and manage subscriptions</li>
            <li>Manage facility access (door unlock)</li>
            <li>Send transactional emails (waivers, booking confirmations, membership reminders)</li>
            <li>Improve our services and user experience</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">4. Third-Party Services</h2>
          <p>
            We use trusted third parties to operate our services: <strong>Stripe</strong> (payments), <strong>Kisi</strong> (door access), and <strong>Google</strong> (email delivery). These providers process data according to their own privacy policies. We do not sell your personal information.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">5. Data Retention</h2>
          <p>
            We retain your information for as long as your account is active or as needed to provide services, comply with legal obligations, resolve disputes, and enforce agreements. You may request deletion of your data by contacting us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">6. Security</h2>
          <p>
            We implement reasonable technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">7. Your Rights</h2>
          <p className="mb-2">Depending on your location, you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Access:</strong> Request a copy of the personal information we hold about you</li>
            <li><strong>Correction:</strong> Request correction of inaccurate information</li>
            <li><strong>Deletion:</strong> Request deletion of your personal information</li>
            <li><strong>Opt-out of sales:</strong> We do not sell personal information. California residents may opt out of &quot;sharing&quot; for cross-context behavioral advertising; we do not engage in such sharing</li>
            <li><strong>Non-discrimination:</strong> We will not discriminate against you for exercising your privacy rights</li>
          </ul>
          <p className="mt-2">
            To exercise these rights, contact us at the email below.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">8. California Residents (CCPA)</h2>
          <p>
            If you are a California resident, the California Consumer Privacy Act (CCPA) provides additional rights. We collect the categories of personal information described in Section 2. We use this information for the purposes described in Section 3. We do not sell or share personal information for cross-context behavioral advertising. You may submit requests by contacting us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">9. Children&apos;s Privacy</h2>
          <p>
            Our services are not directed to individuals under 16. We do not knowingly collect personal information from children under 16. If you believe we have collected such information, please contact us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">10. Changes</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page and updating the &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">11. Contact Us</h2>
          <p>
            For questions about this Privacy Policy or to exercise your rights, contact us at{" "}
            <a href="mailto:ponofitco@gmail.com" className="text-brand-600 hover:underline">ponofitco@gmail.com</a>.
          </p>
        </section>
      </div>
  );
}

export default function PrivacyPolicyPage() {
  const { html, hasFile } = getDocumentSettings("privacy");

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Suspense fallback={<span className="text-stone-500 text-sm mb-6 inline-block">← Back</span>}>
        <BackLink />
      </Suspense>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Privacy Policy</h1>
      <p className="text-stone-500 text-sm mb-8">Last updated: March 2026</p>

      {hasFile ? (
        <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
          <iframe
            src="/api/documents/privacy"
            title="Privacy Policy"
            className="w-full min-h-[70vh] border-0"
          />
        </div>
      ) : html ? (
        <div className="prose prose-stone max-w-none text-sm text-stone-700" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <PrivacyDefaultContent />
      )}
    </div>
  );
}
