import { NextResponse } from "next/server";
import { clearMemberSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearMemberSession();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Logout failed" },
      { status: 500 }
    );
  }
}
