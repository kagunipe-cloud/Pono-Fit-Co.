import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../lib/session";
import { isOpenGroupSessionKind } from "../../../../lib/open-group-pt";
import { CLASSES_DISCONTINUED_API_ERROR } from "../../../../lib/classes-discontinued";

export const dynamic = "force-dynamic";

/** POST { class_occurrence_id: number } — book one occurrence using 1 class credit. */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const occurrenceId = parseInt(body.class_occurrence_id, 10);
    if (Number.isNaN(occurrenceId)) {
      return NextResponse.json({ error: "Invalid class_occurrence_id" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);
    const occurrence = db
      .prepare(
        `SELECT o.id,
                o.occurrence_date,
                o.occurrence_time,
                COALESCE(c.class_name, r.name) AS class_name,
                c.trainer_member_id,
                COALESCE(r.session_kind, 'standard') AS session_kind
         FROM class_occurrences o
         LEFT JOIN classes c ON c.id = o.class_id
         LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
         WHERE o.id = ?`
      )
      .get(occurrenceId) as {
      id: number;
      occurrence_date: string;
      occurrence_time: string | null;
      class_name: string | null;
      trainer_member_id: string | null;
      session_kind: string;
    } | undefined;
    if (!occurrence) {
      db.close();
      return NextResponse.json({ error: "Class occurrence not found" }, { status: 404 });
    }
    if (isOpenGroupSessionKind(occurrence.session_kind)) {
      db.close();
      return NextResponse.json(
        {
          error: "Open Group Personal Training uses a different booking flow — reserve from Book a Class or your invite link.",
        },
        { status: 400 }
      );
    }
    db.close();
    return NextResponse.json({ error: CLASSES_DISCONTINUED_API_ERROR }, { status: 403 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Booking failed" }, { status: 500 });
  }
}
