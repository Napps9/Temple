import { describe, expect, it } from 'vitest';

import { ACTIONS } from './index';
import { scoreActions, shortlist, tokenise } from './shortlist';
import { toWire, type ActionWire } from './types';

const WIRE: ActionWire[] = ACTIONS.map(toWire);

// Every phrasing every action claims for itself, pulled out of its own
// `says`. These are not sentences invented for a test: they were written,
// one action at a time, as the things an owner would actually type, which
// makes them the only honest corpus in the repository.
function examplesOf(action: ActionWire): string[] {
  return [...action.says.matchAll(/"([^"]{6,})"/g)].map((m) => m[1]);
}

const CORPUS = WIRE.flatMap((a) =>
  examplesOf(a).map((text) => ({ text, expect: a.name })),
);

describe('the corpus this is measured against', () => {
  it('comes from the catalogue rather than from imagination', () => {
    // If this ever drops sharply, somebody has stopped writing `says` as
    // sentences and the measurement below is quietly measuring less.
    expect(CORPUS.length).toBeGreaterThan(100);
    const covered = new Set(CORPUS.map((c) => c.expect));
    expect(covered.size / WIRE.length).toBeGreaterThan(0.8);
  });
});

function recallAt(limit: number): { hits: number; misses: { text: string; expect: string }[] } {
  const misses: { text: string; expect: string }[] = [];
  let hits = 0;
  for (const c of CORPUS) {
    const names = shortlist(c.text, WIRE, limit).map((a) => a.name);
    if (names.includes(c.expect)) hits += 1;
    else misses.push(c);
  }
  return { hits, misses };
}

// This is a floor, not a recall measurement, and the distinction matters
// enough to spell out: the corpus is drawn from the same `says` strings
// the scorer indexes, so every sentence here is matched against its own
// vocabulary. It proves no action can become unfindable by the words it
// claims for itself — which is a real regression to catch, and is not
// evidence about sentences nobody wrote down. The held-out set below is.
describe('no action is unfindable by its own words', () => {
  it('holds at every depth worth sending', () => {
    for (const limit of [3, 5, 12]) {
      const { hits, misses } = recallAt(limit);
      if (hits < CORPUS.length) {
        throw new Error(
          `@${limit}: ${hits}/${CORPUS.length}. Misses:\n` +
            misses.map((m) => `  ${m.expect} <- "${m.text}"`).join('\n'),
        );
      }
      expect(hits).toBe(CORPUS.length);
    }
  });

  it('never sends more than it was asked for', () => {
    for (const c of CORPUS.slice(0, 20)) {
      expect(shortlist(c.text, WIRE, 8).length).toBeLessThanOrEqual(8);
    }
  });
});

describe('what the ranking is doing', () => {
  it('drops the words every sentence has', () => {
    expect(tokenise('how are the members doing at the gym')).not.toContain('the');
    expect(tokenise('how are the members doing at the gym')).not.toContain('how');
  });

  it('reads a plural and a singular as the same word', () => {
    expect(tokenise('classes')).toEqual(tokenise('class'));
    expect(tokenise('refunds')).toEqual(tokenise('refund'));
    expect(tokenise('enquiries')).toEqual(tokenise('enquiry'));
  });

  it('ranks a precise word above a common one', () => {
    // "bounce" belongs to one action; "email" belongs to most of comms.
    const scored = scoreActions('did anyone bounce', WIRE);
    expect(scored[0].action.name).toBe('comms.send_report');
  });

  it('returns nothing rather than noise for a sentence with no words in it', () => {
    expect(scoreActions('the a of it', WIRE)).toEqual([]);
  });

  // "do that again" carries no vocabulary at all; the last card does.
  it('keeps what the conversation was about when the sentence says nothing', () => {
    const names = shortlist('do that again', WIRE, 6, ['members.assign_plan']);
    expect(names[0].name).toBe('members.assign_plan');
  });

  it('still sends a catalogue when nothing scores, so `cannot` stays possible', () => {
    expect(shortlist('the a of it', WIRE, 6)).toHaveLength(6);
  });
});

describe('what it saves', () => {
  it('sends a fraction of the payload', () => {
    const full = JSON.stringify(WIRE).length;
    const short = JSON.stringify(shortlist('put Marcus on Unlimited', WIRE, 12)).length;
    expect(short).toBeLessThan(full / 2);
  });
});

// Sentences that mean the same thing in different words. Written by hand
// and deliberately avoiding the catalogue's own phrasing — an owner in a
// hurry does not type the example we wrote for them. This is the only
// out-of-sample signal available before there is real traffic, and it is
// weaker evidence than traffic would be: I chose these sentences knowing
// how the scorer works, which is exactly the bias real logs would not
// have. The number below is therefore an optimistic estimate, and the
// full-catalogue retry exists because it is.
const HELD_OUT: { text: string; expect: string }[] = [
  { text: 'shift the Tuesday 6pm barbell session to Thursday', expect: 'classes.move' },
  { text: 'nobody can teach the 9am, scrub it', expect: 'classes.cancel' },
  { text: 'Jo is taking the Saturday session instead of Marcus', expect: 'classes.set_coach' },
  { text: 'squeeze Priya into tonight’s spin', expect: 'classes.book_member' },
  { text: 'how many bodies came through the door last week', expect: 'classes.attendance' },
  { text: 'anyone stopped turning up lately', expect: 'members.quiet' },
  { text: 'pull up Marcus Webb for me', expect: 'members.find' },
  { text: 'move Sarah onto the unlimited package', expect: 'members.assign_plan' },
  { text: 'give Dan a couple of free sessions', expect: 'members.comp' },
  { text: 'label Priya as a VIP', expect: 'members.tag' },
  { text: 'drop Marcus a note about Saturday', expect: 'members.message' },
  { text: 'what did we take in June', expect: 'money.summary' },
  { text: 'unlimited should cost 95 a month now', expect: 'money.set_plan_price' },
  { text: 'give Dan his money back for last month', expect: 'money.refund' },
  { text: 'we are shut over christmas', expect: 'gym.close_dates' },
  { text: 'make the cancellation window four hours', expect: 'gym.change_rules' },
  { text: 'write everyone a note about the new opening times', expect: 'comms.draft_newsletter' },
  { text: 'hold that mailout until Friday morning', expect: 'comms.schedule_send' },
  { text: 'the price is wrong, halt it', expect: 'comms.stop_send' },
  { text: 'how did the christmas mailout land', expect: 'comms.send_report' },
  { text: 'someone rang up asking about joining', expect: 'leads.add' },
  { text: 'how are the enquiries looking', expect: 'leads.pipeline' },
  { text: 'repeat last week on the whiteboard for next week', expect: 'programming.copy_week' },
  { text: 'wipe what is written for Saturday', expect: 'programming.clear_day' },
  { text: 'take the site live', expect: 'website.publish' },
  { text: 'hide the site for now', expect: 'website.unpublish' },
  { text: 'point irontemple.co.uk at us', expect: 'website.connect_domain' },
  { text: 'has the dns come through yet', expect: 'website.check_domain' },
  { text: 'put a hoodie in the shop at 45', expect: 'store.add_product' },
  { text: 'how is the shop doing', expect: 'store.sales' },
  { text: 'get Sam set up as a coach', expect: 'team.invite' },
  { text: 'who works here', expect: 'team.who' },
];

describe('sentences nobody wrote the catalogue for', () => {
  function heldOutRecall(limit: number) {
    const misses = HELD_OUT.filter(
      (c) => !shortlist(c.text, WIRE, limit).map((a) => a.name).includes(c.expect),
    );
    return { hits: HELD_OUT.length - misses.length, misses };
  }

  it('finds most of them in a shortlist worth sending', () => {
    const { hits, misses } = heldOutRecall(12);
    const recall = hits / HELD_OUT.length;
    if (recall < 0.8) {
      throw new Error(
        `held-out recall@12 = ${(recall * 100).toFixed(0)}% (${hits}/${HELD_OUT.length}). Misses:\n` +
          misses.map((m) => `  ${m.expect} <- "${m.text}"`).join('\n'),
      );
    }
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });
});
