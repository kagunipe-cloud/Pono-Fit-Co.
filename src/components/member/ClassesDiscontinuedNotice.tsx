import Link from "next/link";
import { CLASSES_DISCONTINUED_HEADLINE } from "@/lib/classes-discontinued";
import { OPEN_GROUP_DEFAULT_FLAT_PRICE } from "@/lib/open-group-pt";

type Props = { compact?: boolean };

/** Banner for member class pages while standard classes are paused. */
export function ClassesDiscontinuedNotice({ compact }: Props) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-stone-800 mb-6">
      <p className="font-semibold text-amber-950">{CLASSES_DISCONTINUED_HEADLINE}</p>
      <p className="mt-2 text-sm text-stone-700 leading-relaxed">
        <Link href="/schedule" className="text-brand-700 font-medium hover:underline">
          Book Small-Group PT
        </Link>{" "}
        from an available time on the schedule and invite your friends. Signing up in the app is free — you are only
        charged the flat group fee at the gym after your session (typically ${OPEN_GROUP_DEFAULT_FLAT_PRICE} total for
        your group, however many attend). There is <strong>no cancellation fee</strong> if you need to cancel before
        the session.
      </p>
      {!compact && (
        <p className="mt-3 text-sm flex flex-wrap gap-x-3 gap-y-1">
          <Link href="/schedule" className="text-brand-600 font-medium hover:underline">
            View schedule →
          </Link>
          <Link href="/member/book-pt" className="text-brand-600 font-medium hover:underline">
            Book PT / Small-Group PT →
          </Link>
        </p>
      )}
    </div>
  );
}
