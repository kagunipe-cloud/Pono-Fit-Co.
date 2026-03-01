import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getTrainerMemberId, getAdminMemberId } from "../../../../../../lib/admin";
import { ensureBodyCompositionTable } from "../../../../../../lib/body-composition";
import { ensureTrainerClientsTable } from "../../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

type BodyCompRow = {
  id: number;
  client_member_id: string;
  recorded_at: string;
  body_type: string | null;
  gender: string | null;
  age: number | null;
  height: string | null;
  weight: number | null;
  bmi: number | null;
  fat_pct: number | null;
  bmr: number | null;
  impedance: number | null;
  fat_mass: number | null;
  ffm: number | null;
  tbw: number | null;
  hydration_pct: number | null;
  goal_weight: number | null;
  goal_body_fat: number | null;
  notes: string | null;
  created_at: string | null;
};

/** GET — Body composition entries for this client, sorted by recorded_at desc. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const trainerId = await getTrainerMemberId(_request);
  const adminId = await getAdminMemberId(_request);
  if (!trainerId && !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientMemberId = (await params).id?.trim();
  if (!clientMemberId) {
    return NextResponse.json({ error: "Client id required" }, { status: 400 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);
  const isAdmin = !!adminId;
  if (!isAdmin) {
    const link = db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, clientMemberId);
    if (!link) {
      db.close();
      return NextResponse.json({ error: "You can only view your own clients" }, { status: 403 });
    }
  }

  ensureBodyCompositionTable(db);
  const rows = db.prepare(
    "SELECT * FROM client_body_composition WHERE client_member_id = ? ORDER BY recorded_at DESC"
  ).all(clientMemberId) as BodyCompRow[];

  db.close();
  return NextResponse.json({ entries: rows });
}

/** POST — Add a body composition entry. Body: recorded_at (YYYY-MM-DD), then optional fields matching the sample CSV. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const trainerId = await getTrainerMemberId(request);
  const adminId = await getAdminMemberId(request);
  if (!trainerId && !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientMemberId = (await params).id?.trim();
  if (!clientMemberId) {
    return NextResponse.json({ error: "Client id required" }, { status: 400 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);
  const isAdmin = !!adminId;
  if (!isAdmin) {
    const link = db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, clientMemberId);
    if (!link) {
      db.close();
      return NextResponse.json({ error: "You can only add body comp for your own clients" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const recorded_at = (body.recorded_at ?? "").toString().trim();
  if (!recorded_at) {
    return NextResponse.json({ error: "recorded_at (YYYY-MM-DD) required" }, { status: 400 });
  }

  const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);

  let hydration_pct: number | null = num(body.hydration_pct) ?? null;
  const tbw = num(body.tbw);
  const weight = num(body.weight);
  const fat_pct = num(body.fat_pct);
  if (hydration_pct == null && tbw != null && weight != null && weight > 0) {
    hydration_pct = (tbw / weight) * 100;
  }

  // Derive fat_mass and ffm from weight and fat_pct when not provided (only weight + fat % needed for calculations)
  let fat_mass = num(body.fat_mass);
  let ffm = num(body.ffm);
  if (weight != null && weight > 0 && fat_pct != null && fat_pct >= 0 && fat_pct <= 100) {
    const derivedFatMass = weight * (fat_pct / 100);
    if (fat_mass == null) fat_mass = Math.round(derivedFatMass * 100) / 100;
    if (ffm == null) ffm = Math.round((weight - derivedFatMass) * 100) / 100;
  }

  ensureBodyCompositionTable(db);
  db.prepare(`
    INSERT INTO client_body_composition (
      client_member_id, recorded_at, body_type, gender, age, height,
      weight, bmi, fat_pct, bmr, impedance, fat_mass, ffm, tbw, hydration_pct,
      goal_weight, goal_body_fat, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(
    clientMemberId,
    recorded_at,
    str(body.body_type),
    str(body.gender),
    num(body.age),
    str(body.height),
    weight,
    num(body.bmi),
    fat_pct,
    num(body.bmr) != null ? Math.round(Number(body.bmr)) : null,
    num(body.impedance) != null ? Math.round(Number(body.impedance)) : null,
    fat_mass,
    ffm,
    tbw,
    hydration_pct,
    str(body.notes)
  );

  const id = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  const row = db.prepare("SELECT * FROM client_body_composition WHERE id = ?").get(id.id) as BodyCompRow;
  db.close();

  return NextResponse.json({ entry: row });
}
