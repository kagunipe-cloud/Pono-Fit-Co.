/** Stored in members.insurance_program (SQLite TEXT). */
export const INSURANCE_PROGRAM_VALUES = ["optum", "tivity"] as const;
export type InsuranceProgramValue = (typeof INSURANCE_PROGRAM_VALUES)[number];

export const INSURANCE_PROGRAM_LABELS: Record<InsuranceProgramValue, string> = {
  optum: "Optum",
  tivity: "Tivity Health",
};

/** Display label for `members.insurance_program` (known enum + passthrough for other values). */
export function formatInsuranceProgramLabel(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const t = String(raw).trim();
  if (!t) return "—";
  const k = t.toLowerCase();
  if (k === "optum") return INSURANCE_PROGRAM_LABELS.optum;
  if (k === "tivity" || k === "tivity health") return INSURANCE_PROGRAM_LABELS.tivity;
  return t;
}

export function normalizeInsuranceProgram(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "" || s === "none") return null;
  if (s === "optum") return "optum";
  if (s === "tivity" || s === "tivity health") return "tivity";
  return null;
}
