import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Small-Group Training | Pono Fit Co.",
  description:
    "Train with friends and split the bill. $100/hour total for up to 4 people. Book on the schedule — no payment until after your session.",
  openGraph: {
    title: "Small-Group Training | Pono Fit Co.",
    description: "$100/hour for up to 4 people. Book a slot, invite friends, train together.",
    images: ["/marketing/small-group-training.png"],
  },
};

const SCHEDULE_URL = "https://app.beponofitco.com/schedule";

const STEPS = [
  {
    title: "Book a slot on the schedule",
    note: "No payment required until after the session",
  },
  { title: "Invite your friends" },
  { title: "We train you together" },
  { title: "Split the fee how you like" },
] as const;

export default function SmallGroupTrainingPage() {
  return (
    <div className="min-h-screen bg-[#121412] text-white">
      <div className="relative min-h-[52vh] lg:min-h-[58vh] overflow-hidden">
        <Image
          src="/marketing/small-group-training.png"
          alt=""
          fill
          priority
          className="object-cover object-center opacity-90"
          sizes="100vw"
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-[#121412]/40 via-[#121412]/55 to-[#121412]"
          aria-hidden
        />
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-800 via-brand-500 to-brand-700" />

        <div className="relative z-10 mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10 sm:pt-20 sm:pb-14">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-500 mb-4">
            Pono Fit Co.
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight text-white">
            Small-Group Training
          </h1>
          <p className="mt-4 font-serif text-xl sm:text-2xl text-white/90 italic max-w-xl">
            Train with your friends, and split the bill
          </p>
          <p className="mt-8 inline-block rounded-xl bg-gradient-to-br from-brand-700 via-brand-500 to-brand-400 px-6 py-4 text-lg sm:text-xl font-bold text-[#0f1a12] shadow-lg shadow-brand-500/30">
            $100/hour (total) · up to 4 people
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-16 sm:px-10">
        <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-8 sm:p-10 backdrop-blur-sm">
          <h2 className="font-serif text-2xl sm:text-3xl text-white mb-8">How it works</h2>
          <ol className="space-y-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 sm:gap-5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-base font-bold text-[#0f1a12]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="pt-0.5">
                  <p className="text-lg sm:text-xl font-semibold text-white">{step.title}</p>
                  {"note" in step && step.note ? (
                    <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-400">
                      {step.note}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <Link
            href={SCHEDULE_URL}
            className="inline-flex items-center justify-center min-w-[min(100%,20rem)] rounded-xl bg-brand-500 px-10 py-4 text-lg font-bold text-[#0f1a12] shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 hover:shadow-brand-400/30 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-[#121412]"
          >
            View Schedule to Book
          </Link>
          <p className="text-sm text-white/50 max-w-md">
            Pick a time on the gym schedule, then invite your group. Pay after you train.
          </p>
        </div>

        <p className="mt-14 text-center text-xs text-white/30">
          <Link href="/" className="hover:text-white/50 transition-colors">
            Pono Fit Co.
          </Link>
          {" · "}
          <Link href="/privacy" className="hover:text-white/50 transition-colors">
            Privacy
          </Link>
          {" · "}
          <Link href="/terms" className="hover:text-white/50 transition-colors">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}
