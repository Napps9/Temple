import { describe, expect, it } from 'vitest';

import { finalTranscriptTurn, formatCallDuration, transcriptToText } from './vapi-call';

describe('formatCallDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(42)).toBe('0:42');
    expect(formatCallDuration(65)).toBe('1:05');
    expect(formatCallDuration(3661)).toBe('61:01');
  });

  it('clamps negative input to zero', () => {
    expect(formatCallDuration(-5)).toBe('0:00');
  });
});

describe('finalTranscriptTurn', () => {
  it('extracts a turn from a final transcript message', () => {
    expect(
      finalTranscriptTurn({
        type: 'transcript',
        role: 'assistant',
        transcriptType: 'final',
        transcript: 'First class is free.',
      }),
    ).toEqual({ role: 'assistant', text: 'First class is free.' });
  });

  it('ignores partial transcripts', () => {
    expect(
      finalTranscriptTurn({
        type: 'transcript',
        role: 'user',
        transcriptType: 'partial',
        transcript: 'What is the',
      }),
    ).toBeNull();
  });

  it('ignores unrelated message types and malformed payloads', () => {
    expect(finalTranscriptTurn({ type: 'function-call' })).toBeNull();
    expect(finalTranscriptTurn(null)).toBeNull();
    expect(finalTranscriptTurn('not an object')).toBeNull();
    expect(
      finalTranscriptTurn({ type: 'transcript', role: 'assistant', transcriptType: 'final', transcript: '   ' }),
    ).toBeNull();
  });
});

describe('transcriptToText', () => {
  it('renders turns as a plain-text conversation', () => {
    expect(
      transcriptToText([
        { role: 'assistant', text: 'Hi, how can I help?' },
        { role: 'user', text: "What's the price?" },
      ]),
    ).toBe("AI: Hi, how can I help?\nYou: What's the price?");
  });

  it('returns an empty string for no turns', () => {
    expect(transcriptToText([])).toBe('');
  });
});
