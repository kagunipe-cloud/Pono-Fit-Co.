import { dateStringInAppTz } from "./app-timezone";
import { ashBulkProgramType } from "./insurance-program";

export type AshBulkClaimsVisitRow = {
  first_name: string | null;
  last_name: string | null;
  birthday: string | null;
  happened_at: string;
  insurance_program: string | null;
  insurance_fitness_id: string | null;
};

/** YYYY-MM-DD or ISO → MM/DD/YYYY for ASH bulk file. */
export function formatAshDateMmDdYyyy(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const ymd = t.length >= 10 && t[4] === "-" ? t.slice(0, 10) : t;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return t;
  return t;
}

function csvCell(v: string): string {
  if (/[\t\r\n",]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** ASH Single Location bulk claims file (tab-separated, one row per visit). */
export function buildAshBulkClaimsTsv(rows: AshBulkClaimsVisitRow[], timezone: string): {
  tsv: string;
  exportedRows: number;
  skippedMissingFitnessId: number;
  skippedMissingBirthday: number;
} {
  const header = [
    "FirstName",
    "LastName",
    "Date of Birth",
    "Check in Date",
    "ProgramType",
    "FitnessID",
  ].join("\t");

  const out: string[] = [header];
  let exportedRows = 0;
  let skippedMissingFitnessId = 0;
  let skippedMissingBirthday = 0;

  for (const r of rows) {
    const fitnessId = String(r.insurance_fitness_id ?? "").trim();
    if (!fitnessId) {
      skippedMissingFitnessId++;
      continue;
    }
    const dob = formatAshDateMmDdYyyy(r.birthday);
    if (!dob) {
      skippedMissingBirthday++;
      continue;
    }
    const checkIn = formatAshDateMmDdYyyy(dateStringInAppTz(r.happened_at, timezone));
    const programType = ashBulkProgramType(r.insurance_program);
    if (!programType) continue;

    out.push(
      [
        csvCell(String(r.first_name ?? "").trim()),
        csvCell(String(r.last_name ?? "").trim()),
        csvCell(dob),
        csvCell(checkIn),
        csvCell(programType),
        csvCell(fitnessId),
      ].join("\t")
    );
    exportedRows++;
  }

  return {
    tsv: out.join("\n") + (out.length > 1 ? "\n" : ""),
    exportedRows,
    skippedMissingFitnessId,
    skippedMissingBirthday,
  };
}
