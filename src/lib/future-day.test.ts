import { describe, expect, it } from 'vitest';

import {
  campaignLine,
  classLine,
  closureLine,
  composeFutureDay,
  renewalLine,
  taskLine,
  type FutureClass,
} from './future-day';

function cls(partial: Partial<FutureClass>): FutureClass {
  return {
    id: 'c1',
    name: 'CrossFit',
    startsAt: '2026-08-07T06:00:00',
    capacity: 12,
    booked: 9,
    uncovered: false,
    ...partial,
  };
}

describe('classLine', () => {
  it('counts the booked against the room', () => {
    const line = classLine(cls({}));
    expect(line.text).toBe('CrossFit at 6:00am — 9 of 12 booked.');
    expect(line.tone).toBe('neutral');
    expect(line.lead).toBe('CrossFit');
    expect(line.href).toBe('/classes');
  });

  it('says full, empty and uncapped plainly', () => {
    expect(classLine(cls({ booked: 12 })).text).toBe(
      'CrossFit at 6:00am — full.',
    );
    expect(classLine(cls({ booked: 0 })).text).toBe(
      'CrossFit at 6:00am — nobody booked yet.',
    );
    expect(classLine(cls({ capacity: null, booked: 4 })).text).toBe(
      'CrossFit at 6:00am — 4 booked.',
    );
  });

  it('flags a class still needing a coach, in amber', () => {
    const line = classLine(cls({ uncovered: true }));
    expect(line.text).toBe(
      'CrossFit at 6:00am — 9 of 12 booked. Still needs a coach.',
    );
    expect(line.tone).toBe('amber');
  });
});

describe('the rest of the day, in the register', () => {
  it('says a closure on its own day, and a range when it spans', () => {
    expect(
      closureLine({ id: 'x', startsOn: '2026-12-25', endsOn: '2026-12-25' }).text,
    ).toBe('The gym is closed this day.');
    expect(
      closureLine({ id: 'x', startsOn: '2026-12-24', endsOn: '2026-12-28' }).text,
    ).toBe('The gym is closed this day — closed from 24 Dec to 28 Dec.');
  });

  it('names the send and when it fires', () => {
    const line = campaignLine({
      id: 'e1',
      title: 'Bring a friend week',
      scheduledFor: '2026-08-07T09:00:00',
    });
    expect(line.text).toBe('“Bring a friend week” goes out at 9:00am.');
    expect(line.lead).toBe('“Bring a friend week”');
    expect(line.href).toBe('/management/communications/e1');
  });

  it('names the renewal and the person', () => {
    const line = renewalLine({
      profileId: 'p1',
      name: 'Marcus',
      planName: 'Unlimited',
    });
    expect(line.text).toBe("Marcus's Unlimited renews.");
    expect(line.href).toBe('/management/members/p1');
  });

  it('says whose task falls due, and copes with nobody assigned', () => {
    expect(
      taskLine({ id: 't1', title: 'Call the landlord', assigneeName: 'Sam' }).text,
    ).toBe("Task due: Call the landlord — Sam's.");
    expect(
      taskLine({ id: 't1', title: 'Call the landlord', assigneeName: null }).text,
    ).toBe('Task due: Call the landlord.');
  });
});

describe('composeFutureDay', () => {
  it('opens with whether the gym is open, then runs the day in order', () => {
    const lines = composeFutureDay({
      closures: [{ id: 'x', startsOn: '2026-08-07', endsOn: '2026-08-07' }],
      classes: [
        cls({ id: 'late', startsAt: '2026-08-07T18:00:00' }),
        cls({ id: 'early', startsAt: '2026-08-07T06:00:00' }),
      ],
      campaigns: [
        { id: 'e1', title: 'Hello', scheduledFor: '2026-08-07T09:00:00' },
      ],
      renewals: [{ profileId: 'p1', name: 'Marcus', planName: 'Unlimited' }],
      tasks: [{ id: 't1', title: 'Call the landlord', assigneeName: null }],
    });
    expect(lines.map((l) => l.key)).toEqual([
      'closure:x',
      'class:early',
      'class:late',
      'campaign:e1',
      'renewal:p1',
      'task:t1',
    ]);
  });

  it('is quiet about an empty day', () => {
    expect(
      composeFutureDay({
        closures: [],
        classes: [],
        campaigns: [],
        renewals: [],
        tasks: [],
      }),
    ).toEqual([]);
  });
});
