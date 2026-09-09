import { describe, expect, it } from 'vitest';

import {
  outboundSmsSender,
  twilioSenderParam,
} from '../../supabase/functions/_shared/sms-sender';

// Plain TypeScript with no Deno imports, so the decision that governs
// every text Temple sends can be exercised here rather than only in
// production. Two things it has to get right: a gym's own number wins
// whenever it can carry SMS, and a number that cannot carry SMS is never
// handed to Twilio as a From — which is the defect that made the AI
// front desk tell a caller it could not text him.

describe('outboundSmsSender', () => {
  it('uses the gym own number when it can carry SMS', () => {
    expect(outboundSmsSender('+447700900123', true, 'MG0123')).toBe('+447700900123');
  });

  it('falls back to Temple sender when the gym number is voice-only', () => {
    expect(outboundSmsSender('+441614960000', false, 'MG0123')).toBe('MG0123');
  });

  it('falls back to Temple sender when the gym has no number at all', () => {
    expect(outboundSmsSender(null, false, 'MG0123')).toBe('MG0123');
  });

  // The one that has to stay null rather than becoming a guess: with no
  // sender anywhere there is nothing to put in From, and a caller that
  // treats "" as a sender gets a Twilio 400 it then has to explain.
  it('is null when neither the gym nor Temple can send', () => {
    expect(outboundSmsSender(null, false, null)).toBeNull();
    expect(outboundSmsSender('+441614960000', false, '')).toBeNull();
  });

  // sms_capable false with a number present is the state every gym
  // provisioned before 0270 is in, so it is the common case, not an edge.
  it('never returns a voice-only number even with no fallback', () => {
    expect(outboundSmsSender('+441614960000', false, null)).toBeNull();
  });
});

describe('twilioSenderParam', () => {
  it('sends a Messaging Service under MessagingServiceSid', () => {
    expect(twilioSenderParam('MG9752274e9e519418a7406176694466fa')).toEqual([
      'MessagingServiceSid',
      'MG9752274e9e519418a7406176694466fa',
    ]);
  });

  it('sends a plain number under From', () => {
    expect(twilioSenderParam('+447700900123')).toEqual(['From', '+447700900123']);
  });
});
