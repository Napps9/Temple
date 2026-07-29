import { describe, expect, it } from 'vitest';

// "continue setup" is answered on the client, before any model
// round-trip — the phrase is unambiguous and the owner asking for it is
// usually mid-task. Kept in sync with the pattern in
// src/app/(staff)/timeline.tsx.
const SETUP_INTENT =
  /^(continue|finish|resume|carry on with|back to|go to|open|complete)?\s*(the\s+)?set\s?up$|^set\s?up\s+(please|again)$/i;

describe('the setup intent', () => {
  it('recognises the ways an owner asks to get back in', () => {
    for (const phrase of [
      'continue setup',
      'Continue set up',
      'finish setup',
      'resume setup',
      'carry on with setup',
      'back to setup',
      'go to set up',
      'open setup',
      'complete setup',
      'setup',
      'set up',
      'setup please',
      'set up again',
    ]) {
      expect(SETUP_INTENT.test(phrase), phrase).toBe(true);
    }
  });

  it('leaves real change requests to the parser', () => {
    for (const phrase of [
      'free cancel until 2 hours before',
      'add a 7am Wednesday spin class',
      'set up a new class type',
      'close the gym 24 to 28 December',
      'send a newsletter about setup week',
      'setup the timetable for me',
    ]) {
      expect(SETUP_INTENT.test(phrase), phrase).toBe(false);
    }
  });
});
