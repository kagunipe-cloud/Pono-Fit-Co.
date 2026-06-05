import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureRecurringClassesTables } from "@/lib/recurring-classes";
import { getMemberIdFromSession } from "@/lib/session";
import {
  effectiveOpenGroupCapacity,
  isOpenGroupSessionKind,
  OPEN_GROUP_DEFAULT_FLAT_PRICE,
} from "@/lib/open-group-pt";

export const dynamic = "force-dynamic";

/** GET ?occurrence_id= — logged-in member: role, counts, invite URL if organizer. */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const occurrenceId = parseInt(request.nextUrl.searchParams.get("occurrence_id") ?? "", 10);
    if (Number.isNaN(occurrenceId)) {
      return NextResponse.json({ error: "occurrence_id required" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);

    const occurrence = db
      .prepare(
        `SELECT o.id,
                o.capacity,
                o.open_group_share_token,
                o.occurrence_date,
                o.occurrence_time,
                COALESCE(r.session_kind, 'standard') AS session_kind,
                NULLIF(TRIM(r.flat_session_price), '') AS flat_session_price,
                COALESCE(c.class_name, r.name) AS class_name
         FROM class_occurrences o
         LEFT JOIN classes c ON c.id = o.class_id
         LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
         WHERE o.id = ?`
      )
      .get(occurrenceId) as
      | {
          id: number;
          capacity: number | null;
          open_group_share_token: string | null;
          occurrence_date: string;
          occurrence_time: string | null;
          session_kind: string;
          flat_session_price: string | null;
          class_name: string | null;
        }
      | undefined;

    if (!occurrence || !isOpenGroupSessionKind(occurrence.session_kind)) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const cap = effectiveOpenGroupCapacity(occurrence.capacity);
    const flatLabel = occurrence.flat_session_price ?? OPEN_GROUP_DEFAULT_FLAT_PRICE;

    const countRow = db
      .prepare("SELECT COUNT(*) AS n FROM occurrence_bookings WHERE class_occurrence_id = ?")
      .get(occurrenceId) as { n: number };
    const booked = countRow?.n ?? 0;

    const mine = db
      .prepare(
        `SELECT COALESCE(booking_role, 'standard') AS booking_role FROM occurrence_bookings WHERE class_occurrence_id = ? AND member_id = ?`
      )
      .get(occurrenceId, memberId) as { booking_role: string } | undefined;

    db.close();

    const origin = request.nextUrl.origin;
    const tok = (occurrence.open_group_share_token ?? "").trim();
    const share_url =
      mine?.booking_role === "organizer" && tok
        ? `${origin}/member/open-group-pt/join?occurrence_id=${occurrenceId}&token=${encodeURIComponent(tok)}`
        : undefined;

    return NextResponse.json({
      occurrence_id: occurrenceId,
      class_name: occurrence.class_name ?? "Open Group Personal Training",
      occurrence_date: occurrence.occurrence_date,
      occurrence_time: occurrence.occurrence_time,
      session_kind: occurrence.session_kind,
      flat_session_price: flatLabel,
      capacity: cap,
      booked_count: booked,
      my_role: mine?.booking_role === "organizer" || mine?.booking_role === "guest" ? mine.booking_role : null,
      share_url,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
