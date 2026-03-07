import { Suspense } from "react";
import { BRAND } from "@/lib/branding";
import { BackLink } from "@/components/BackLink";

export const metadata = {
  title: `Terms of Service | ${BRAND.name}`,
  description: `Terms of service for ${BRAND.name} membership and fitness services.`,
};

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Suspense fallback={<span className="text-stone-500 text-sm mb-6 inline-block">← Back</span>}>
        <BackLink />
      </Suspense>
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Terms of Service</h1>
      <p className="text-stone-500 text-sm mb-8">Last updated: March 2025</p>

      <div className="prose prose-stone max-w-none space-y-6 text-sm text-stone-700">
        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">1. Agreement to Terms</h2>
          <p>
            By accessing or using the services of PBJB LLC, doing business as {BRAND.name} (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;), including our website, mobile app, and in-person facilities, you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree, do not use our services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">2. Membership and Services</h2>
          <p>
            We provide gym membership, group classes, personal training, and related fitness services. Membership terms, pricing, and benefits are described at the time of purchase. You must maintain accurate account information and comply with facility rules posted on-site.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">3. Payment and Billing</h2>
          <p>
            Fees are due as specified in your membership agreement. By providing payment information, you authorize us to charge your chosen payment method for recurring fees until you cancel. Failed payments may result in suspension of access. Refunds are subject to our refund policy communicated at purchase.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">4. Cancellation</h2>
          <p>
            You may cancel your membership according to the terms of your membership plan. Cancellation may be subject to notice requirements or fees. Upon cancellation, you retain access until the end of your paid period unless otherwise specified.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">5. Waiver and Release of Liability</h2>
          <p>
            By using our facilities and services, you acknowledge that physical activity involves inherent risks of injury. You agree to sign our liability waiver before using the facility. You release PBJB LLC, its owners, employees, and affiliates from any liability for injury, loss, or damage arising from your participation, except where prohibited by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">6. Prohibited Conduct</h2>
          <p className="mb-2">You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use our services for any illegal purpose</li>
            <li>Share your account or access credentials</li>
            <li>Harass, threaten, or harm other members or staff</li>
            <li>Damage equipment or facilities</li>
            <li>Violate posted facility rules or staff instructions</li>
          </ul>
          <p className="mt-2">
            We may suspend or terminate your access for violation of these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">7. Intellectual Property</h2>
          <p>
            The {BRAND.name} name, logo, and content are owned by PBJB LLC. You may not use them without our prior written consent.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">8. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, we are not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or data, arising from your use of our services. Our total liability shall not exceed the amount you paid us in the twelve months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">9. Dispute Resolution</h2>
          <p>
            Any dispute arising from these Terms or our services shall be resolved through good-faith negotiation. If unresolved, disputes may be submitted to binding arbitration or small claims court, as permitted by law. You waive any right to participate in class actions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">10. Changes</h2>
          <p>
            We may modify these Terms at any time. Material changes will be communicated via email or notice in our app. Continued use after changes constitutes acceptance. If you do not agree, you must cancel your membership.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">11. General</h2>
          <p>
            These Terms constitute the entire agreement between you and PBJB LLC. If any provision is found unenforceable, the remaining provisions remain in effect. Our failure to enforce any right does not waive that right.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-stone-800 mt-6 mb-2">12. Contact</h2>
          <p>
            For questions about these Terms, contact us at{" "}
            <a href="mailto:ponofitco@gmail.com" className="text-brand-600 hover:underline">ponofitco@gmail.com</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
