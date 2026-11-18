/** Shared CSV parse/format for exercise bulk edit (Excel / Sheets). */

/** Parse one CSV line respecting quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        cell += c;
      }
    } else if (c === ",") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  out.push(cell.trim());
  return out;
}

/** Split CSV text into logical lines (newlines inside quoted fields do not split). */
export function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

export function escapeCsvCell(value: string): string {
  const v = value ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(",");
}

/** Split primary/secondary/antagonist cells from Excel (comma or semicolon). */
export function splitMuscleCell(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCsvHeaderRow(headerLine: string): string[] {
  return parseCsvLine(headerLine).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
}

export function headerIndex(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const i = headers.findIndex((h) => h === name);
    if (i >= 0) return i;
  }
  return -1;
}