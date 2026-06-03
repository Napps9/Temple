// CSV builder with two non-negotiable guards:
//
// 1. Injection guard: spreadsheet apps treat cells starting with =, +,
//    -, @, tab, or CR as live formulas/macros. We prepend a single '
//    so the cell renders as text. Without this, an attacker who can
//    influence a member's name could exfiltrate data via a downloaded
//    export.
//
// 2. UTF-8 BOM + CRLF: Excel only autodetects UTF-8 when the file
//    starts with the BOM, otherwise non-ASCII characters (e.g.
//    accented names, emoji) get mangled. RFC 4180 specifies CRLF line
//    endings.

const INJECTION_PREFIX_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);
const BOM = '﻿';

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else if (value instanceof Date) s = value.toISOString();
  else s = JSON.stringify(value);

  if (s.length > 0 && INJECTION_PREFIX_CHARS.has(s[0]!)) {
    s = `'${s}`;
  }

  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

export type CsvColumn<Row> = {
  key: keyof Row | string;
  header: string;
  // Optional formatter for the cell value (defaults to row[key]).
  format?: (row: Row) => unknown;
};

export function buildCsv<Row>(
  rows: Row[],
  columns: CsvColumn<Row>[],
): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const value = c.format
          ? c.format(row)
          : (row as Record<string, unknown>)[c.key as string];
        return escapeCell(value);
      })
      .join(','),
  );
  return BOM + [header, ...lines].join('\r\n') + '\r\n';
}

export async function downloadCsv(filename: string, csv: string): Promise<void> {
  // Web detection without importing react-native at module scope — keeps
  // csv.ts importable by Vitest without a react-native bundler.
  const isWeb =
    typeof document !== 'undefined' && typeof URL !== 'undefined' && 'createObjectURL' in URL;
  if (isWeb) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  const [fs, sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  const file = new fs.File(fs.Paths.cache, filename);
  file.write(csv);
  if (await sharing.isAvailableAsync()) {
    await sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: filename,
    });
  }
}
