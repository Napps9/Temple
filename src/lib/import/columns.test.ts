import { describe, expect, it } from 'vitest';

import { autoDetect, buildImportRow, toIsoDate } from './columns';

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
  it('returns null for nonsense', () => {
    expect(toIsoDate('whenever')).toBe(null);
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
});
