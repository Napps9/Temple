import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  loadSuppressed,
  SUPPRESSED_REASON,
} from '../../supabase/functions/_shared/suppression';

// The shared helper is plain TypeScript with no Deno imports, so it can be
// exercised here rather than only in production. What it has to get right
// is the tenancy: the same person can bounce for one gym and be perfectly
// reachable at another, and a shared platform must never let one gym's bad
// list silence another gym's mail.

function client(rows: { gym_id: string; email: string }[], fail = false) {
  return {
    from: () => ({
      select: () => ({
        in: (_column: string, values: string[]) =>
          Promise.resolve(
            fail
              ? { data: null, error: { message: 'boom' } }
              : { data: rows.filter((r) => values.includes(r.gym_id)), error: null },
          ),
      }),
    }),
  };
}

const GYM_A = 'gym-a';
const GYM_B = 'gym-b';

describe('addresses a gym cannot reach', () => {
  it('holds a suppressed address back', async () => {
    const s = await loadSuppressed(client([{ gym_id: GYM_A, email: 'gone@x.test' }]), [
      GYM_A,
    ]);
    expect(s.has(GYM_A, 'gone@x.test')).toBe(true);
    expect(s.has(GYM_A, 'fine@x.test')).toBe(false);
  });

  it('matches however the address was cased or padded', async () => {
    const s = await loadSuppressed(client([{ gym_id: GYM_A, email: 'Gone@X.test' }]), [
      GYM_A,
    ]);
    expect(s.has(GYM_A, 'gone@x.test')).toBe(true);
    expect(s.has(GYM_A, '  GONE@X.TEST ')).toBe(true);
  });

  // The tenancy line, and the reason the key is a pair rather than an
  // address.
  it('never lets one gym’s bounce silence another gym’s mail', async () => {
    const s = await loadSuppressed(client([{ gym_id: GYM_A, email: 'gone@x.test' }]), [
      GYM_A,
      GYM_B,
    ]);
    expect(s.has(GYM_A, 'gone@x.test')).toBe(true);
    expect(s.has(GYM_B, 'gone@x.test')).toBe(false);
  });

  // Not sending a member the news that their class is cancelled, because a
  // side table was briefly unreadable, is a bigger harm than mailing an
  // address that bounces.
  it('lets the queue through when the lookup itself fails', async () => {
    const s = await loadSuppressed(client([], true), [GYM_A]);
    expect(s.has(GYM_A, 'gone@x.test')).toBe(false);
  });

  it('asks nothing when there are no gyms to ask about', async () => {
    const s = await loadSuppressed(
      {
        from: () => {
          throw new Error('should not have queried');
        },
      },
      [],
    );
    expect(s.has(GYM_A, 'gone@x.test')).toBe(false);
  });

  it('treats a missing address as reachable rather than throwing', async () => {
    const s = await loadSuppressed(client([{ gym_id: GYM_A, email: 'gone@x.test' }]), [
      GYM_A,
    ]);
    expect(s.has(GYM_A, null)).toBe(false);
    expect(s.has(GYM_A, undefined)).toBe(false);
  });
});

// Every worker that mails a member's stored address on a schedule has to
// check. Grepped because the failure is invisible — the send goes out,
// Resend refuses it, and the only trace is a failed row nobody reads.
describe('every recurring sender checks', () => {
  const WORKERS = [
    'send-class-change-notifications',
    'send-cover-notifications',
    'send-payment-notifications',
    'send-email-automations',
  ];

  for (const worker of WORKERS) {
    it(`${worker} holds back a suppressed address`, () => {
      const src = readFileSync(`supabase/functions/${worker}/index.ts`, 'utf8');
      expect(src).toMatch(/loadSuppressed\(service, /);
      expect(src).toMatch(/suppressed\.has\(/);
      expect(src).toMatch(/status: 'skipped', error: SUPPRESSED_REASON/);
    });
  }

  it('records why rather than looking like a delivery failure', () => {
    expect(SUPPRESSED_REASON).toMatch(/bounced|spam/);
  });
});
