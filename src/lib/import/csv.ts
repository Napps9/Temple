// RFC 4180-ish CSV parser. Handles double-quoted cells (with embedded
// commas and newlines), `""` as an escaped quote inside a quoted cell,
// and unquoted cells with leading/trailing whitespace trimmed. Returns
// rows of strings; the caller does header detection + column mapping.
//
// Dependency-free on purpose — every fitness-CRM export comes back as
// well-behaved CSV, and an external parser would haul a SAX-style API
// (papaparse / fast-csv) into the bundle just to read what the user
// drops into a textarea once at import time.

export type CsvRow = string[];

export function parseCsv(input: string): CsvRow[] {
  if (input.charCodeAt(0) === 0xfeff) {
    // Strip UTF-8 BOM that Excel-on-Windows likes to prefix.
    input = input.slice(1);
  }

  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      // Skip empty trailing line.
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

// "First Name" + "Last Name" → "First Last"; either alone fine.
export function joinName(parts: (string | undefined | null)[]): string | null {
  const cleaned = parts.map((p) => (p ?? '').trim()).filter(Boolean);
  return cleaned.length === 0 ? null : cleaned.join(' ');
}
