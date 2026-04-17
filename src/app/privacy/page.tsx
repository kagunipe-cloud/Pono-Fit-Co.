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
            <li><strong>Account information:</strong> Name, email address, phone number, age or date of birth when you provide it, and member ID</li>
            <li><strong>Payment information:</strong> Processed by Stripe; we do not store full card numbers or bank account details. We accept credit/debit cards and ACH (bank account) payments for memberships, classes, and personal training. Billing address is collected at checkout for payment processing and tax compliance.</li>
            <li><strong>Membership and booking data:</strong> Subscriptions, class bookings, personal training sessions</li>
            <li><strong>Fitness and nutrition data:</strong> Workout logs, macro tracking, foods and targets you log, and related information you choose to enter</li>
            <li><strong>In-app preferences:</strong> Favorites and saved items you choose to store in the app (for example, saved foods or routines)</li>
            <li><strong>Search and discovery:</strong> Queries you enter in macro and nutrition search may be stored and used to improve search results and suggestions for you and other members (for example, ranking popular items)</li>
            <li><strong>Check-ins and visits:</strong> Records of facility check-ins or visits when you use check-in features or door access, used for membership operations and (where applicable) occupancy or usage reporting</li>
            <li><strong>Usage information:</strong> How you interact with the app and our services—such as feature use, timestamps, and technical information from your requests—to operate the product, troubleshoot, secure accounts, and improve performance and user experience</li>
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
            <li>Manage facility access (door unlock) and record check-ins or visits as needed for your membership</li>
            <li>Send transactional emails (waivers, booking confirmations, membership reminders)</li>
            <li>Store and display your favorites, workouts, macros, and other content you save</li>
            <li>Improve search in nutrition and macro features using past searches and aggregated patterns</li>
            <li>Understand product usage, fix issues, improve performance, and develop features (including internal analytics and reporting)</li>
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
            We retain your information for as long as your account is active or as needed to provide services, comply with legal obligations, resolve disputes, and enforce agreements. You may delete your member account yourself in our mobile app (see Section 8) or request deletion of your data by contacting us at the email below.
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
            To exercise these rights, contact us at the email below. You may also delete your account directly in our mobile app as described in Section 8.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">8. Deleting your account (mobile app)</h2>
          <p className="mb-2">
            If you use the {BRAND.name} mobile app (iOS or Android), you can initiate account deletion from your member profile. Open <strong>Profile</strong>, scroll to <strong>Delete account</strong>, and follow the steps. You must have a password on your account to confirm deletion; if you have not set one yet, use the password section on the same page or your set-password link first.
          </p>
          <p className="mb-2">
            <strong>What happens when you delete:</strong> We revoke door access with our access provider (Kisi) and sign you out. If you have <strong>no</strong> purchase, subscription, or booking history in our system, we remove your member profile. If you <strong>do</strong> have that history (for example memberships, classes, or payments we must retain for business or legal reasons), we close your login and remove personal details we no longer need (such as your real name, contact information, and similar profile fields) while keeping anonymized or operational records tied to your member ID where the law or our legitimate business purposes require it.
          </p>
          <p>
            Account deletion in the app is available only in the native mobile app, not on the website dashboard. Staff (admin) accounts cannot be deleted through this flow; contact us if you need help with a staff account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">9. California Residents (CCPA)</h2>
          <p>
            If you are a California resident, the California Consumer Privacy Act (CCPA) provides additional rights. We collect the categories of personal information described in Section 2. We use this information for the purposes described in Section 3. We do not sell or share personal information for cross-context behavioral advertising. You may submit requests by contacting us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">10. Children&apos;s Privacy</h2>
          <p>
            Our services are not directed to individuals under 16. We do not knowingly collect personal information from children under 16. If you believe we have collected such information, please contact us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">11. Changes</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page and updating the &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">12. Contact Us</h2>
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
      <p className="text-stone-500 text-sm mb-8">Last updated: April 2026</p>

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
