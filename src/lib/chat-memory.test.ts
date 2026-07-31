import { describe, expect, it } from 'vitest';

import {
  FRESH_MS,
  MAX_TURNS,
  recentTurns,
  toWireTurns,
  type Turn,
} from './chat-memory';

const NOW = 1_780_000_000_000;

function turn(role: Turn['role'], text: string, agoMs = 0): Turn {
  return { role, text, at: NOW - agoMs };
}

describe('what the bar carries forward', () => {
  it('sends the recent conversation, oldest first', () => {
    const turns = [
      turn('owner', 'show me Marcus', 4000),
      turn('gym', 'Marcus Webb — Active, Off-peak', 3000),
      turn('owner', 'put him on Unlimited', 1000),
    ];
    expect(recentTurns(turns, NOW).map((t) => t.text)).toEqual([
      'show me Marcus',
      'Marcus Webb — Active, Off-peak',
      'put him on Unlimited',
    ]);
  });

  it('keeps the last few and drops the rest', () => {
    const turns = Array.from({ length: 20 }, (_, i) =>
      turn(i % 2 === 0 ? 'owner' : 'gym', `line ${i}`, 1000),
    );
    const kept = recentTurns(turns, NOW);
    expect(kept).toHaveLength(MAX_TURNS);
    expect(kept[kept.length - 1].text).toBe('line 19');
  });

  // The rule that matters. Acting on the wrong person is not recoverable;
  // failing to understand is.
  it('forgets a subject that has gone cold', () => {
    const turns = [
      turn('owner', 'show me Marcus', FRESH_MS + 1000),
      turn('gym', 'Marcus Webb — Active', FRESH_MS + 500),
    ];
    expect(recentTurns(turns, NOW)).toEqual([]);
  });

  // 0221 persists turns for ninety days and restores them on open, which
  // would be a way to resurrect a stale subject if the freshness bound
  // were anywhere but here. Yesterday's conversation reads back on screen
  // and carries nothing forward into today's sentence.
  it('restores a day-old conversation as history and sends none of it', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const yesterday: Turn[] = [
      { role: 'owner', text: 'show me Marcus', at: now - day },
      { role: 'gym', text: 'Marcus Webb', at: now - day },
    ];
    expect(recentTurns(yesterday, now)).toEqual([]);
    // And the moment something is said today, only that travels.
    const resumed: Turn[] = [
      ...yesterday,
      { role: 'owner', text: 'how busy was Saturday', at: now },
    ];
    expect(recentTurns(resumed, now).map((t) => t.text)).toEqual([
      'how busy was Saturday',
    ]);
  });

  it('keeps the fresh half of a conversation that spans the window', () => {
    const turns = [
      turn('owner', 'show me Marcus', FRESH_MS + 1000),
      turn('gym', 'Marcus Webb — Active', FRESH_MS + 500),
      turn('owner', 'show me Sarah', 2000),
      turn('gym', 'Sarah Doyle — Lapsed', 1000),
    ];
    expect(recentTurns(turns, NOW).map((t) => t.text)).toEqual([
      'show me Sarah',
      'Sarah Doyle — Lapsed',
    ]);
  });

  it('leaves out anything with nothing in it', () => {
    expect(recentTurns([turn('owner', '   ')], NOW)).toEqual([]);
  });

  it('trims a long card so one answer cannot crowd out the question', () => {
    const long = turn('gym', 'x'.repeat(5000));
    expect(recentTurns([turn('owner', 'hi', 100), long], NOW)[1].text).toHaveLength(300);
  });
});

describe('the shape it goes up in', () => {
  it('alternates, because the API will not take two of the same in a row', () => {
    expect(
      toWireTurns([
        turn('owner', 'show me Marcus'),
        turn('gym', 'Which one?'),
        turn('gym', 'Marcus Webb'),
        turn('owner', 'put him on Unlimited'),
      ]),
    ).toEqual([
      { role: 'user', content: 'show me Marcus' },
      { role: 'assistant', content: 'Which one?\nMarcus Webb' },
      { role: 'user', content: 'put him on Unlimited' },
    ]);
  });

  // A window can open on a reply — the fresh cut-off does not care where a
  // conversation happened to start — and the first thing said cannot be an
  // answer to nothing.
  it('never opens on the gym talking to itself', () => {
    const wire = toWireTurns([
      turn('gym', 'Marcus Webb — Active'),
      turn('owner', 'put him on Unlimited'),
    ]);
    expect(wire[0]).toEqual({ role: 'user', content: 'put him on Unlimited' });
  });

  it('is empty when there is nothing to carry', () => {
    expect(toWireTurns([])).toEqual([]);
    expect(toWireTurns([turn('gym', 'anything')])).toEqual([]);
  });
});
