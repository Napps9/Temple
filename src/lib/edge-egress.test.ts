import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Every door out of Temple, and who is allowed through it.
//
// Temple has three public demo tenants whose owner passwords are published.
// A visitor signed into one is an ordinary owner holding all forty-three
// capabilities, so the only thing that can stop them mailing a stranger or
// charging a card is a guard at the point an edge function calls a vendor.
// Migration 0278 added gyms.is_demo; the guards read it.
//
// The failure this file exists to prevent is not a guard being removed —
// that shows up in review. It is the fortieth edge function, written next
// year by somebody who never read any of this, quietly opening a new door.
// So the inventory lives here rather than in a comment: a file that names
// an external host and is not in POLICY fails, and the message tells its
// author what to do about it.
//
// It scans for host literals rather than for `fetch(` deliberately. Two
// functions hold their vendor URL in a constant (sending-domain's
// RESEND_BASE, stripe-connect-start's authorize URL) and a fetch-adjacent
// regex misses both — which is exactly the shape a new door would take.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FUNCTIONS = join(ROOT, 'supabase/functions');

// Hosts that are Temple talking to itself, or an import. Not egress.
const OURS = [
  'supabase.co',
  'jointemple.io',
  'esm.sh',
  'localhost',
  '127.0.0.1',
  'schema.org',
  'www.w3.org',
];

// The only vendors a demo gym may still reach. Both cost tokens and neither
// is observed by anybody outside Temple — and they are the demo: the AI
// front desk answering, the setup parser reading a timetable, a voice
// sample playing. Silencing them to make the demo safe would make it not
// worth showing. Nothing may be added here without the same being true.
const NO_EXTERNAL_OBSERVER = ['api.anthropic.com', 'api.elevenlabs.io'];

type Rule =
  | { rule: 'guarded' }
  | { rule: 'allowed'; why: string }
  | { rule: 'platform'; why: string };

const POLICY: Record<string, Rule> = {
  // --- guarded: reaches a person, or moves money ---------------------------
  '_shared/lead-agent.ts': { rule: 'guarded' },
  'agent-interview/index.ts': { rule: 'guarded' },
  'apply-plan-changes/index.ts': { rule: 'guarded' },
  'deprovision-front-desk/index.ts': { rule: 'guarded' },
  'provision-front-desk/index.ts': { rule: 'guarded' },
  'refund-store-order/index.ts': { rule: 'guarded' },
  'send-agent-messages/index.ts': { rule: 'guarded' },
  'send-campaign/index.ts': { rule: 'guarded' },
  'send-class-change-notifications/index.ts': { rule: 'guarded' },
  'send-cover-notifications/index.ts': { rule: 'guarded' },
  'send-email-automations/index.ts': { rule: 'guarded' },
  'send-invite/index.ts': { rule: 'guarded' },
  'send-lead-notifications/index.ts': { rule: 'guarded' },
  'send-member-join-invites/index.ts': { rule: 'guarded' },
  'send-member-messages/index.ts': { rule: 'guarded' },
  'send-payment-notifications/index.ts': { rule: 'guarded' },
  'sending-domain/index.ts': { rule: 'guarded' },
  'store-cancel-subscription/index.ts': { rule: 'guarded' },
  'store-checkout/index.ts': { rule: 'guarded' },
  'stripe-account/index.ts': { rule: 'guarded' },
  'stripe-billing-portal/index.ts': { rule: 'guarded' },
  'stripe-checkout/index.ts': { rule: 'guarded' },
  'stripe-connect-callback/index.ts': { rule: 'guarded' },
  'stripe-connect-start/index.ts': { rule: 'guarded' },
  'stripe-import/index.ts': { rule: 'guarded' },
  'stripe-modify-subscription/index.ts': { rule: 'guarded' },
  'stripe-refund/index.ts': { rule: 'guarded' },
  'stripe-webhook/index.ts': { rule: 'guarded' },
  'sync-vapi-assistant/index.ts': { rule: 'guarded' },

  // --- allowed: costs tokens, observed by nobody ---------------------------
  'classify-programming/index.ts': {
    rule: 'allowed',
    why: 'reads the coach’s own programming back to them',
  },
  'explain-event/index.ts': {
    rule: 'allowed',
    why: 'explains a line on the timeline to the person looking at it',
  },
  'generate-agent-prompt/index.ts': {
    rule: 'allowed',
    why: 'drafts the front desk’s brief, which an owner then approves',
  },
  'infer-import/index.ts': {
    rule: 'allowed',
    why: 'reads a CSV the visitor uploaded and guesses its columns',
  },
  'parse-setup/index.ts': {
    rule: 'allowed',
    why: 'reads a timetable somebody typed and turns it into classes',
  },
  'voice-sample/index.ts': {
    rule: 'allowed',
    why: 'plays a voice back to the person choosing it',
  },

  // --- platform: Temple's own mail, not the gym's --------------------------
  'security-alert/index.ts': {
    rule: 'platform',
    why: 'mails Temple, not the gym’s members — a demo gym tripping the security monitor is exactly when we want to hear about it',
  },
};

const GUARD_MARKERS = ['gymIsDemo', 'is_demo', 'isDemo'];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function externalHosts(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
    const host = m[1].toLowerCase();
    if (!OURS.some((ours) => host.endsWith(ours))) found.add(host);
  }
  return [...found].sort();
}

const scanned = tsFiles(FUNCTIONS)
  .map((full) => ({
    path: relative(FUNCTIONS, full).split('\\').join('/'),
    hosts: externalHosts(readFileSync(full, 'utf8')),
    source: readFileSync(full, 'utf8'),
  }))
  .filter((f) => f.hosts.length);

describe('every door out of Temple is accounted for', () => {
  // A scanner that silently finds nothing would pass everything below it.
  it('finds the vendor calls at all', () => {
    expect(scanned.length).toBeGreaterThan(30);
  });

  it('has a policy for every file that names an external host', () => {
    const unlisted = scanned.filter((f) => !POLICY[f.path]);
    expect(
      unlisted.map((f) => `${f.path} -> ${f.hosts.join(', ')}`),
      'A new edge function calls a vendor. Decide which it is and add it to ' +
        'POLICY in this file: "guarded" if the call reaches a person or moves ' +
        'money (then read gyms.is_demo and hold it back for a demo gym, the way ' +
        'the senders do), or "allowed" with a reason if it costs tokens and ' +
        'nobody outside Temple observes it.',
    ).toEqual([]);
  });

  it('has no stale policy entry', () => {
    const live = new Set(scanned.map((f) => f.path));
    expect(Object.keys(POLICY).filter((p) => !live.has(p))).toEqual([]);
  });

  it('guards every file that reaches a person or moves money', () => {
    const unguarded = scanned
      .filter((f) => POLICY[f.path]?.rule === 'guarded')
      .filter((f) => !GUARD_MARKERS.some((marker) => f.source.includes(marker)))
      .map((f) => f.path);
    expect(unguarded).toEqual([]);
  });

  // The load-bearing one. Without it, the way to make this suite green is to
  // move a file from "guarded" to "allowed", which is also the way to let a
  // demo gym mail a stranger.
  it('only allows vendors nobody outside Temple observes', () => {
    const wrong = scanned
      .filter((f) => POLICY[f.path]?.rule === 'allowed')
      .flatMap((f) =>
        f.hosts
          .filter((h) => !NO_EXTERNAL_OBSERVER.includes(h))
          .map((h) => `${f.path} is allowed but calls ${h}`),
      );
    expect(wrong).toEqual([]);
  });

  it('keeps the platform exception to exactly one file', () => {
    const platform = Object.entries(POLICY)
      .filter(([, r]) => r.rule === 'platform')
      .map(([p]) => p);
    expect(platform).toEqual(['security-alert/index.ts']);
  });

  it('makes every exception state a reason', () => {
    const silent = Object.entries(POLICY)
      .filter(([, r]) => r.rule !== 'guarded')
      .filter(([, r]) => !('why' in r) || r.why.trim().length < 20)
      .map(([p]) => p);
    expect(silent).toEqual([]);
  });
});
