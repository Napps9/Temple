import { describe, expect, it } from 'vitest';

import {
  primaryRow,
  sanitiseSequence,
  sequenceLines,
  stepRows,
  triggerSentence,
} from './sequence-draft';

const WELCOME = {
  name: 'New member welcome',
  trigger: 'member_joined',
  emails: [
    { after_days: 0, subject: 'Welcome to Temple', heading: 'You are in', body: 'Great to have you with us. Come and say hello.' },
    { after_days: 7, subject: 'How is week one?', heading: 'One week in', body: 'How are you finding it? Reply and let us know.' },
  ],
};

describe('sanitiseSequence', () => {
  it('keeps a valid sequence and orders the emails by when they go', () => {
    const d = sanitiseSequence({
      ...WELCOME,
      emails: [WELCOME.emails[1], WELCOME.emails[0]],
    })!;
    expect(d.name).toBe('New member welcome');
    expect(d.trigger).toBe('member_joined');
    expect(d.emails.map((e) => e.afterDays)).toEqual([0, 7]);
    expect(d.emails[0].subject).toBe('Welcome to Temple');
  });

  it('needs a name, a trigger it recognises, and at least one usable email', () => {
    expect(sanitiseSequence({ ...WELCOME, name: '' })).toBeNull();
    expect(sanitiseSequence({ ...WELCOME, trigger: 'member_birthday' })).toBeNull();
    expect(sanitiseSequence({ ...WELCOME, emails: [] })).toBeNull();
    expect(sanitiseSequence({ ...WELCOME, emails: 'two of them' })).toBeNull();
    expect(sanitiseSequence(null)).toBeNull();
  });

  it('drops an email it cannot use rather than sending a blank one', () => {
    const d = sanitiseSequence({
      ...WELCOME,
      emails: [
        WELCOME.emails[0],
        { after_days: 3, subject: 'Hi', heading: 'x', body: 'heading too short' },
        { after_days: 5, subject: 'Hi', heading: 'Fine heading', body: 'short' },
      ],
    })!;
    expect(d.emails).toHaveLength(1);
  });

  // A tag automation with no tag matches nobody for ever, and an owner who
  // saw it created would assume it worked.
  it('refuses a tag trigger with no tag', () => {
    expect(
      sanitiseSequence({ ...WELCOME, trigger: 'member_tagged' }),
    ).toBeNull();
    expect(
      sanitiseSequence({ ...WELCOME, trigger: 'member_tagged', tag: 'VIP' })?.tag,
    ).toBe('VIP');
    // Only member_tagged carries one.
    expect(sanitiseSequence({ ...WELCOME, tag: 'VIP' })?.tag).toBeNull();
  });

  it('defaults the threshold when they named a trigger but no number', () => {
    expect(
      sanitiseSequence({ ...WELCOME, trigger: 'member_inactive' })?.threshold,
    ).toBe(21);
    expect(sanitiseSequence({ ...WELCOME, trigger: 'lead_cold' })?.threshold).toBe(24);
    expect(
      sanitiseSequence({ ...WELCOME, trigger: 'member_inactive', threshold: 30 })
        ?.threshold,
    ).toBe(30);
    // Zero days quiet is not a threshold, it is everybody.
    expect(
      sanitiseSequence({ ...WELCOME, trigger: 'member_inactive', threshold: 0 })
        ?.threshold,
    ).toBe(21);
    // And a delay-based trigger has no threshold at all.
    expect(sanitiseSequence(WELCOME)?.threshold).toBeNull();
  });

  it('caps the sequence and the wait', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      after_days: i,
      subject: `Email ${i}`,
      heading: `Heading ${i}`,
      body: 'A body long enough to survive the sanitiser.',
    }));
    expect(sanitiseSequence({ ...WELCOME, emails: many })?.emails).toHaveLength(5);
    const silly = sanitiseSequence({
      ...WELCOME,
      emails: [{ ...WELCOME.emails[0], after_days: 4000 }],
    })!;
    // Out of range falls back to "straight away" rather than scheduling a
    // welcome eleven years out.
    expect(silly.emails[0].afterDays).toBe(0);
  });
});

describe('mapping onto the automations engine', () => {
  it('makes the first email the automation itself and the rest steps', () => {
    const d = sanitiseSequence(WELCOME)!;
    const row = primaryRow(d);
    expect(row.subject).toBe('Welcome to Temple');
    expect(row.delay_minutes).toBe(0);
    expect(row.params).toEqual({});

    const steps = stepRows(d);
    expect(steps).toHaveLength(1);
    // Measured from the anchor, not from the previous email: day 7 is
    // 7 * 1440, never "4 days after the one before".
    expect(steps[0]).toEqual({
      step_index: 0,
      delay_minutes: 7 * 1440,
      subject: 'How is week one?',
    });
  });

  it('carries a delay-trigger wait into delay_minutes', () => {
    const d = sanitiseSequence({
      ...WELCOME,
      trigger: 'member_first_class',
      emails: [{ ...WELCOME.emails[0], after_days: 2 }],
    })!;
    expect(primaryRow(d).delay_minutes).toBe(2 * 1440);
  });

  // The trap 0116/0119 lay: for these two the wait IS the trigger, and
  // knobToStorage pins delay_minutes to 0. A primary email that claimed to
  // go "14 days after" would have fired at the threshold instead.
  it('reads the number as a threshold, not a wait, when the trigger is one', () => {
    const d = sanitiseSequence({
      ...WELCOME,
      trigger: 'member_inactive',
      threshold: 30,
      emails: [{ ...WELCOME.emails[0], after_days: 14 }],
    })!;
    const row = primaryRow(d);
    expect(row.delay_minutes).toBe(0);
    expect(row.params).toEqual({ inactive_days: 30 });

    const cold = sanitiseSequence({
      ...WELCOME,
      trigger: 'lead_cold',
      threshold: 48,
      emails: [WELCOME.emails[0]],
    })!;
    expect(primaryRow(cold).params).toEqual({ cold_hours: 48 });
  });

  it('puts the tag in params where the engine looks for it', () => {
    const d = sanitiseSequence({
      ...WELCOME,
      trigger: 'member_tagged',
      tag: 'VIP',
      emails: [WELCOME.emails[0]],
    })!;
    expect(primaryRow(d).params).toEqual({ tag: 'VIP' });
  });
});

describe('reading a sequence back', () => {
  it('says when it starts in the owner’s terms', () => {
    expect(triggerSentence(sanitiseSequence(WELCOME)!)).toBe(
      'Starts when someone joins the gym.',
    );
    expect(
      triggerSentence(
        sanitiseSequence({ ...WELCOME, trigger: 'member_inactive', threshold: 30 })!,
      ),
    ).toBe('Starts when a member has not trained for 30 days.');
    expect(
      triggerSentence(
        sanitiseSequence({ ...WELCOME, trigger: 'member_tagged', tag: 'VIP' })!,
      ),
    ).toBe('Starts when a member is tagged “VIP”.');
  });

  it('lays the emails out and never hides that it arrives switched off', () => {
    const lines = sequenceLines(sanitiseSequence(WELCOME)!);
    expect(lines[0]).toBe('Starts when someone joins the gym.');
    expect(lines[1]).toBe('Straight away: “Welcome to Temple”');
    expect(lines[2]).toBe('A week later: “How is week one?”');
    expect(lines[lines.length - 1]).toContain('switched off');
  });

  it('says the wait the way a person would', () => {
    const at = (days: number) =>
      sequenceLines(
        sanitiseSequence({
          ...WELCOME,
          emails: [{ ...WELCOME.emails[0], after_days: days }],
        })!,
      )[1];
    expect(at(0)).toContain('Straight away');
    expect(at(1)).toContain('A day later');
    expect(at(7)).toContain('A week later');
    expect(at(14)).toContain('2 weeks later');
    expect(at(5)).toContain('5 days later');
  });
});
