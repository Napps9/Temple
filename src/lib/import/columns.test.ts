import { describe, expect, it } from 'vitest';

import { autoDetect, buildImportRow, columnHints, toIsoDate } from './columns';

describe('autoDetect', () => {
  it('matches the Mindbody export shape', () => {
    expect(
      autoDetect([
        'Client Email',
        'First Name',
        'Last Name',
        'DOB',
        'Membership Type',
        'Start Date',
        'End Date',
        'Status',
      ]),
    ).toEqual([
      'email',
      'first_name',
      'last_name',
      'date_of_birth',
      'plan_name',
      'plan_start',
      'plan_end',
      'imported_status',
    ]);
  });
  it('matches the PushPress / SugarWOD export shape', () => {
    expect(
      autoDetect([
        'Email',
        'Name',
        'Birthday',
        'Plan',
        'Joined',
        'Expires',
        'Tags',
      ]),
    ).toEqual([
      'email',
      'full_name',
      'date_of_birth',
      'plan_name',
      'plan_start',
      'plan_end',
      'tags',
    ]);
  });
  it('matches the Glofox export shape', () => {
    expect(
      autoDetect([
        'Email Address',
        'Member Name',
        'Membership Plan',
        'Active Since',
        'Next Renewal',
        'Marketing Opt-out',
      ]),
    ).toEqual([
      'email',
      'full_name',
      'plan_name',
      'plan_start',
      'plan_end',
      'unsubscribed',
    ]);
  });
  it("leaves unrecognised columns as null and doesn't double-assign", () => {
    expect(autoDetect(['email', 'Email Address', 'random_col'])).toEqual([
      'email',
      null,
      null,
    ]);
  });
  it('matches a WodBoard-style export with phone, emergency contact and next bill date', () => {
    expect(
      autoDetect(['Mobile Number', 'Emergency Contact Name', 'Next Bill Date']),
    ).toEqual(['phone', 'emergency_contact', 'next_bill_date']);
  });
  it("doesn't double-assign a second emergency-contact-shaped column", () => {
    // A source export split into Name + Number: only the first
    // auto-maps (the field's already used); the owner maps the second
    // by hand, and buildImportRow concatenates once they do.
    expect(
      autoDetect(['Emergency Contact Name', 'Emergency Contact Number']),
    ).toEqual(['emergency_contact', null]);
  });
});

describe('toIsoDate', () => {
  it('passes ISO through', () => {
    expect(toIsoDate('2025-04-12')).toBe('2025-04-12');
  });
  it('parses US M/D/Y', () => {
    expect(toIsoDate('4/12/2025')).toBe('2025-04-12');
    expect(toIsoDate('4/12/25')).toBe('2025-04-12');
  });
  it('parses EU D.M.Y', () => {
    expect(toIsoDate('12.4.2025')).toBe('2025-04-12');
  });
  it('flips YYYY-DD-MM when the month slot is > 12', () => {
    // Specific failure that showed up in the import preview.
    expect(toIsoDate('1992-16-03')).toBe('1992-03-16');
  });
  it('flips a DD/MM/YYYY slash date when the month slot is > 12', () => {
    // A real value from a WodBoard export (UK gym, day-first dates) —
    // previously dropped entirely as "month 15".
    expect(toIsoDate('15/11/2026')).toBe('2026-11-15');
    expect(toIsoDate('17/05/2024')).toBe('2024-05-17');
  });
  it('rejects YYYY-MM-DD with an out-of-range day', () => {
    expect(toIsoDate('1992-03-32')).toBe(null);
    // Ambiguous: month > 12 AND day > 12 — can't safely flip, return null.
    expect(toIsoDate('1992-13-13')).toBe(null);
  });
  it('parses slash- and dot-separated ISO (YYYY/MM/DD)', () => {
    expect(toIsoDate('2024/01/15')).toBe('2024-01-15');
    expect(toIsoDate('2024.01.15')).toBe('2024-01-15');
  });
  it('parses spelled-out months, day- or month-first', () => {
    expect(toIsoDate('15 Jan 2024')).toBe('2024-01-15');
    expect(toIsoDate('15 January 2024')).toBe('2024-01-15');
    expect(toIsoDate('Jan 15, 2024')).toBe('2024-01-15');
    expect(toIsoDate('January 15 2024')).toBe('2024-01-15');
    expect(toIsoDate('15-Jan-2024')).toBe('2024-01-15');
    expect(toIsoDate('1 Sep 99')).toBe('2099-09-01');
  });
  it('parses a bare Excel serial date in a sane window', () => {
    expect(toIsoDate('45000')).toBe('2023-03-15');
  });
  it('leaves a year-only or out-of-window number alone', () => {
    // "2024" is a plausible year but not a full date, and it's below the
    // Excel-serial window — must not be mis-read as a serial.
    expect(toIsoDate('2024')).toBe(null);
    expect(toIsoDate('100')).toBe(null);
  });
  it('returns null for nonsense', () => {
    expect(toIsoDate('whenever')).toBe(null);
    expect(toIsoDate('15 Foo 2024')).toBe(null);
  });
});

describe('buildImportRow', () => {
  const headers = ['Email', 'First Name', 'Last Name', 'DOB', 'Plan', 'Tags', 'No Marketing'];
  const mapping = autoDetect(headers);

  it('assembles a Mindbody-style row', () => {
    const out = buildImportRow(headers, mapping, [
      'ADA@Example.COM',
      'Ada',
      'Lovelace',
      '12/10/1815',
      'Gold Monthly',
      'VIP, Founders',
      'No',
    ]);
    expect(out).toEqual({
      email: 'ada@example.com',
      full_name: 'Ada Lovelace',
      date_of_birth: '1815-12-10',
      plan_name: 'Gold Monthly',
      tags: ['VIP', 'Founders'],
      unsubscribed: false,
    });
  });
  it('reads "y" / "yes" / "opt-out" as unsubscribed', () => {
    for (const v of ['Y', 'yes', 'true', '1', 'Opted out']) {
      const out = buildImportRow(headers, mapping, ['x@y.z', '', '', '', '', '', v]);
      expect(out.unsubscribed).toBe(true);
    }
  });
  it('skips empty cells silently', () => {
    expect(
      buildImportRow(headers, mapping, ['a@b.c', '', '', '', '', '', '']),
    ).toEqual({ email: 'a@b.c' });
  });

  it('parses next_bill_date as a date like plan_start/plan_end', () => {
    const hs = ['Email', 'Next Bill Date'];
    const out = buildImportRow(hs, autoDetect(hs), ['a@b.c', '15/11/2026']);
    expect(out.next_bill_date).toBe('2026-11-15');
  });

  it('concatenates two columns mapped to emergency_contact rather than overwriting', () => {
    const hs = ['Email', 'Emergency Contact Name', 'Emergency Contact Number'];
    // Second column doesn't auto-map (see autoDetect test) — map it by
    // hand, as the owner would in the review step.
    const map = autoDetect(hs).map((f) =>
      f === null ? 'emergency_contact' : f,
    );
    const out = buildImportRow(hs, map, ['a@b.c', 'Grace Hopper', '07700900123']);
    expect(out.emergency_contact).toBe('Grace Hopper — 07700900123');
  });

  it('drops an unparseable next_bill_date rather than throwing', () => {
    const hs = ['Email', 'Next Bill Date'];
    const out = buildImportRow(hs, autoDetect(hs), ['a@b.c', 'whenever']);
    expect(out.next_bill_date).toBeUndefined();
  });

  it('reorders a surname-first full name to natural order', () => {
    const hs = ['Email', 'Name'];
    const out = buildImportRow(hs, autoDetect(hs), ['a@b.c', 'Smith, John']);
    expect(out.full_name).toBe('John Smith');
  });
  it('leaves a full name with no comma untouched', () => {
    const hs = ['Email', 'Name'];
    expect(
      buildImportRow(hs, autoDetect(hs), ['a@b.c', 'John Smith Jr']).full_name,
    ).toBe('John Smith Jr');
    // More than one comma is ambiguous — leave it as the source had it.
    expect(
      buildImportRow(hs, autoDetect(hs), ['a@b.c', 'Smith, John, Jr']).full_name,
    ).toBe('Smith, John, Jr');
  });
});

describe('columnHints', () => {
  it('profiles each column by value kind without leaking raw values', () => {
    const hints = columnHints(
      ['Email', 'Name', 'DOB', 'Plan'],
      [
        ['ada@example.com', 'Ada Lovelace', '1815-12-10', 'Gold'],
        ['grace@example.com', 'Grace Hopper', '1906-12-09', 'Gold'],
        ['alan@example.com', 'Alan Turing', '1912-06-23', 'Drop-in'],
      ],
    );
    expect(hints.map((h) => h.kind)).toEqual(['email', 'text', 'date', 'text']);
    // The profile carries header + shape only — never the cell values.
    const serialised = JSON.stringify(hints);
    expect(serialised).not.toContain('ada@example.com');
    expect(serialised).not.toContain('Lovelace');
  });

  it('reports fill rate and distinct ratio over the present values', () => {
    const [plan, email] = columnHints(
      ['Plan', 'Email'],
      [
        ['Gold', 'a@b.com'],
        ['Gold', 'c@d.com'],
        ['', 'e@f.com'],
        ['Drop-in', 'g@h.com'],
      ],
    );
    expect(plan.fill_rate).toBe(0.75); // 3 of 4 rows present
    expect(plan.distinct_ratio).toBe(0.67); // 2 distinct of 3 present
    expect(email.kind).toBe('email');
    expect(email.fill_rate).toBe(1);
    expect(email.distinct_ratio).toBe(1);
  });

  it('marks an all-empty column as empty', () => {
    const [notes] = columnHints(['Notes'], [[''], [''], ['']]);
    expect(notes.kind).toBe('empty');
    expect(notes.fill_rate).toBe(0);
    expect(notes.distinct_ratio).toBe(0);
  });
});
