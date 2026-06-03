import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCell } from './csv';

const BOM = '﻿';

describe('escapeCell', () => {
  it('returns empty string for null and undefined', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });

  it('serialises numbers and booleans', () => {
    expect(escapeCell(42)).toBe('42');
    expect(escapeCell(0)).toBe('0');
    expect(escapeCell(true)).toBe('true');
    expect(escapeCell(false)).toBe('false');
  });

  it('round-trips emoji bytes', () => {
    expect(escapeCell('💪🏋️')).toBe('💪🏋️');
  });

  it('quotes cells containing commas, quotes, or newlines and doubles internal quotes', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('a"b')).toBe('"a""b"');
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    // Quote + comma combined.
    expect(escapeCell('"Steve" Hawks, owner')).toBe('"""Steve"" Hawks, owner"');
  });

  it('does not quote ordinary text', () => {
    expect(escapeCell('Hello world')).toBe('Hello world');
  });

  it('prefixes injection-prone leading characters with a quote', () => {
    expect(escapeCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCell('+44 1234')).toBe("'+44 1234");
    // Negative number IS injection-prone in spreadsheets.
    expect(escapeCell('-99 Notes')).toBe("'-99 Notes");
    expect(escapeCell('@user')).toBe("'@user");
    expect(escapeCell('\tindent')).toBe("'\tindent");
    // Leading \r gets both the injection prefix AND the CRLF-containing
    // quote wrap, since \r also triggers RFC 4180 quoting.
    expect(escapeCell('\rcarriage')).toBe(`"'\rcarriage"`);
  });

  it('combines injection prefix with quoting when the cell also contains commas', () => {
    // Leading '=' triggers the apostrophe prefix; comma triggers quoting.
    expect(escapeCell('=A1+B1, danger')).toBe(`"'=A1+B1, danger"`);
  });

  it('serialises Date as ISO string', () => {
    const d = new Date('2026-06-03T12:00:00Z');
    expect(escapeCell(d)).toBe('2026-06-03T12:00:00.000Z');
  });
});

describe('buildCsv', () => {
  type Row = { name: string; email: string; spent: number | null };

  it('emits BOM, CRLF line endings, and quoted headers/cells', () => {
    const rows: Row[] = [
      { name: 'Ada Lovelace', email: 'ada@example.com', spent: 240 },
      { name: 'Grace, Hopper', email: 'grace@navy.mil', spent: null },
    ];
    const csv = buildCsv(rows, [
      { key: 'name', header: 'Member name' },
      { key: 'email', header: 'Email' },
      { key: 'spent', header: 'Spent (£)' },
    ]);
    expect(csv).toBe(
      BOM +
        [
          'Member name,Email,Spent (£)',
          'Ada Lovelace,ada@example.com,240',
          '"Grace, Hopper",grace@navy.mil,',
        ].join('\r\n') +
        '\r\n',
    );
  });

  it('uses the format function when provided', () => {
    const rows = [{ name: 'Ada', joined_at: '2026-05-01T10:00:00Z' }];
    const csv = buildCsv(rows, [
      { key: 'name', header: 'Name' },
      {
        key: 'joined_at',
        header: 'Joined',
        format: (r) => r.joined_at.slice(0, 10),
      },
    ]);
    expect(csv).toBe(BOM + 'Name,Joined\r\nAda,2026-05-01\r\n');
  });

  it('emits header-only output when the row list is empty', () => {
    const csv = buildCsv<Row>([], [
      { key: 'name', header: 'Member name' },
      { key: 'email', header: 'Email' },
      { key: 'spent', header: 'Spent (£)' },
    ]);
    expect(csv).toBe(BOM + 'Member name,Email,Spent (£)\r\n');
  });
});
