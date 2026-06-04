/** Stored in members.insurance_program (SQLite TEXT). */
export const INSURANCE_PROGRAM_VALUES = [
  "optum",
  "tivity",
  "ash_silver_fit",
  "ash_active_fit",
] as const;

export type InsuranceProgramValue = (typeof INSURANCE_PROGRAM_VALUES)[number];

/** Report filter tabs (ASH groups Silver & Fit + Active & Fit). */
export const INSURANCE_REPORT_FILTER_VALUES = ["all", "optum", "tivity", "ash"] as const;
export type InsuranceReportFilter = (typeof INSURANCE_REPORT_FILTER_VALUES)[number];

export const ASH_INSURANCE_PROGRAM_VALUES = ["ash_silver_fit", "ash_active_fit"] as const;
export type AshInsuranceProgramValue = (typeof ASH_INSURANCE_PROGRAM_VALUES)[number];

export const INSURANCE_PROGRAM_LABELS: Record<InsuranceProgramValue, string> = {
  optum: "Optum",
  tivity: "Tivity Health",
  ash_silver_fit: "ASH — Silver & Fit",
  ash_active_fit: "ASH — Active & Fit",
};

export const INSURANCE_REPORT_FILTER_LABELS: Record<InsuranceReportFilter, string> = {
  all: "All insurance programs",
  optum: INSURANCE_PROGRAM_LABELS.optum,
  tivity: INSURANCE_PROGRAM_LABELS.tivity,
  ash: "ASH (Silver & Fit + Active & Fit)",
};

/** ProgramType column text for ASH bulk claims upload. */
export const ASH_BULK_PROGRAM_TYPE: Record<AshInsuranceProgramValue, string> = {
  ash_silver_fit: "Silver and Fit",
  ash_active_fit: "Active and Fit",
};

/** Display label for `members.insurance_program` (known enum + passthrough for other values). */
export function formatInsuranceProgramLabel(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const t = String(raw).trim();
  if (!t) return "—";
  const k = t.toLowerCase();
  if (k === "optum") return INSURANCE_PROGRAM_LABELS.optum;
  if (k === "tivity" || k === "tivity health") return INSURANCE_PROGRAM_LABELS.tivity;
  if (k === "ash_silver_fit") return INSURANCE_PROGRAM_LABELS.ash_silver_fit;
  if (k === "ash_active_fit") return INSURANCE_PROGRAM_LABELS.ash_active_fit;
  return t;
}

export function normalizeInsuranceProgram(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "" || s === "none") return null;
  if (s === "optum") return "optum";
  if (s === "tivity" || s === "tivity health") return "tivity";
  if (s === "ash_silver_fit" || s === "silver & fit" || s === "silver and fit") return "ash_silver_fit";
  if (s === "ash_active_fit" || s === "active & fit" || s === "active and fit") return "ash_active_fit";
  return null;
}

export function isAshInsuranceProgram(raw: string | null | undefined): boolean {
  const k = String(raw ?? "").trim().toLowerCase();
  return k === "ash_silver_fit" || k === "ash_active_fit";
}

export function isValidInsuranceReportFilter(raw: string): raw is InsuranceReportFilter {
  return (INSURANCE_REPORT_FILTER_VALUES as readonly string[]).includes(raw);
}

export function ashBulkProgramType(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  if (k === "ash_silver_fit") return ASH_BULK_PROGRAM_TYPE.ash_silver_fit;
  if (k === "ash_active_fit") return ASH_BULK_PROGRAM_TYPE.ash_active_fit;
  return "";
}

export function insuranceProgramWhereClause(program: InsuranceReportFilter): {
  clause: string;
  args: string[];
} {
  if (program === "all") {
    return {
      clause: "m.insurance_program IS NOT NULL AND LENGTH(TRIM(m.insurance_program)) > 0",
      args: [],
    };
  }
  if (program === "ash") {
    return {
      clause: "m.insurance_program IN ('ash_silver_fit', 'ash_active_fit')",
      args: [],
    };
  }
  return { clause: "m.insurance_program = ?", args: [program] };
}
