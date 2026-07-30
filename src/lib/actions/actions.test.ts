import { describe, expect, it } from 'vitest';

import { editClasses } from './classes';
import { addClasses, addPlans, changeRules, closeGym, draftNewsletter } from './gym';
import { ACTIONS, actionsFor, findAction } from './index';
import { findMember } from './members';
import { addStoreProduct, matchProduct, setStoreProductPrice, storeSales } from './store';
import { argInt, argMoney, argString } from './types';

describe('the registry', () => {
  it('names every action uniquely and describes every argument', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of ACTIONS) {
      expect(a.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(a.says.length).toBeGreaterThan(20);
      const argNames = a.args.map((arg) => arg.name);
      expect(new Set(argNames).size).toBe(argNames.length);
      for (const arg of a.args) {
        expect(arg.desc.length).toBeGreaterThan(3);
      }
      for (const key of a.invalidate ?? []) {
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every `do` an apply and no `ask` one', () => {
    for (const a of ACTIONS) {
      if (a.kind === 'do') expect(typeof a.apply).toBe('function');
      else expect(a.apply).toBeUndefined();
    }
  });

  it('only offers what the caller may actually do', () => {
    const none = actionsFor(() => false);
    expect(none).toEqual([]);
    // Undefined is "not loaded yet", which is not permission.
    expect(actionsFor(() => undefined)).toEqual([]);
    const storeOnly = actionsFor((c) => c === 'can_manage_store');
    expect(storeOnly.map((a) => a.name)).toContain('store.add_product');
    expect(storeOnly.map((a) => a.name)).not.toContain('store.sales');
  });

  it('resolves an action by name and refuses anything else', () => {
    expect(findAction('store.add_product')?.name).toBe('store.add_product');
    expect(findAction('store.delete_everything')).toBeNull();
    expect(findAction(null)).toBeNull();
    expect(findAction(42)).toBeNull();
  });

  // The Timeline dispatches every verb through the registry, so a verb
  // missing from it is a verb the owner can no longer say.
  it('carries every verb the talk bar answers to', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'gym.change_rules',
        'gym.add_classes',
        'gym.add_plans',
        'gym.close_dates',
        'comms.draft_newsletter',
        'classes.edit',
        'members.find',
        'store.add_product',
        'store.set_price',
        'store.sales',
      ]),
    );
  });
});

describe('argument readers', () => {
  it('takes money the way people write it, in pounds, and stores pence', () => {
    expect(argMoney({ price: 1 }, 'price')).toBe(100);
    expect(argMoney({ price: '£1.50' }, 'price')).toBe(150);
    expect(argMoney({ price: '35' }, 'price')).toBe(3500);
    expect(argMoney({ price: 0 }, 'price')).toBe(0);
  });

  it('refuses money it would have to round or invent', () => {
    expect(argMoney({ price: '1.005' }, 'price')).toBeNull();
    expect(argMoney({ price: 'a fiver' }, 'price')).toBeNull();
    expect(argMoney({ price: -5 }, 'price')).toBeNull();
    expect(argMoney({ price: 99999 }, 'price')).toBeNull();
    expect(argMoney({}, 'price')).toBeNull();
  });

  it('bounds integers and tidies strings', () => {
    expect(argInt({ stock: 20 }, 'stock', 0, 100)).toBe(20);
    expect(argInt({ stock: 500 }, 'stock', 0, 100)).toBeNull();
    expect(argString({ name: '  water   bottle ' }, 'name')).toBe('water bottle');
    expect(argString({ name: '   ' }, 'name')).toBeNull();
  });
});

describe('store actions', () => {
  it('needs a name and a price before it will add anything', () => {
    expect(addStoreProduct.sanitise({ name: 'Water bottle', price: 1 })).toEqual({
      name: 'Water bottle',
      priceCents: 100,
      kind: 'physical',
      stock: null,
    });
    expect(addStoreProduct.sanitise({ name: 'Water bottle' })).toBeNull();
    expect(addStoreProduct.sanitise({ price: 1 })).toBeNull();
  });

  it('takes stock and kind when they were said', () => {
    expect(
      addStoreProduct.sanitise({ name: 'Hoodie', price: 35, stock: 20 })?.stock,
    ).toBe(20);
    expect(
      addStoreProduct.sanitise({ name: 'Guide', price: 12, kind: 'digital' })?.kind,
    ).toBe('digital');
    // An invented kind falls back rather than reaching the insert.
    expect(
      addStoreProduct.sanitise({ name: 'Guide', price: 12, kind: 'course' })?.kind,
    ).toBe('physical');
  });

  it('previews a bottle the way the owner would read it back', async () => {
    const args = addStoreProduct.sanitise({ name: 'Water bottle', price: 1 })!;
    const preview = await addStoreProduct.preview(args, null as never);
    expect(preview.title).toBe('Add this to the shop?');
    expect(preview.lines[0]).toBe('Water bottle — £1');
  });

  it('defaults the sales window to a month', () => {
    expect(storeSales.sanitise({})).toEqual({ days: 30 });
    expect(storeSales.sanitise({ days: 7 })).toEqual({ days: 7 });
    expect(storeSales.sanitise({ days: 99999 })).toEqual({ days: 30 });
  });

  it('needs both halves of a price change', () => {
    expect(setStoreProductPrice.sanitise({ name: 'Water bottle', price: 2 })).toEqual({
      name: 'Water bottle',
      priceCents: 200,
    });
    expect(setStoreProductPrice.sanitise({ name: 'Water bottle' })).toBeNull();
  });
});

describe('the gym actions', () => {
  it('takes the rule changes it recognises and refuses the rest', () => {
    expect(
      changeRules.sanitise({
        rule_changes: [{ field: 'late_cancel', value: 'rel:120' }],
      }),
    ).toEqual({ changes: [{ field: 'late_cancel', value: 'rel:120' }] });
    // An invented field, an out-of-menu enum, and no changes at all.
    expect(changeRules.sanitise({ rule_changes: [{ field: 'free_beer', value: true }] })).toBeNull();
    expect(
      changeRules.sanitise({ rule_changes: [{ field: 'week_starts_on', value: 'tue' }] }),
    ).toBeNull();
    expect(changeRules.sanitise({})).toBeNull();
  });

  // sanitise judges shape only — whether a change is a change depends on
  // the gym's live settings, which preview and apply each read for
  // themselves so a stale card can't act on settings that have moved.
  it('lets a no-op through sanitise for preview to catch', () => {
    expect(
      changeRules.sanitise({ rule_changes: [{ field: 'week_starts_on', value: 'mon' }] }),
    ).toEqual({ changes: [{ field: 'week_starts_on', value: 'mon' }] });
  });

  it('needs two real dates the right way round before it will close', () => {
    expect(closeGym.sanitise({ starts_on: '2026-12-24', ends_on: '2026-12-28' })).toEqual({
      startsOn: '2026-12-24',
      endsOn: '2026-12-28',
      reason: null,
    });
    expect(closeGym.sanitise({ starts_on: '2026-12-28', ends_on: '2026-12-24' })).toBeNull();
    expect(closeGym.sanitise({ starts_on: '24 December', ends_on: '2026-12-28' })).toBeNull();
    expect(
      closeGym.sanitise({ starts_on: '2026-12-24', ends_on: '2026-12-24', reason: ' Christmas ' })
        ?.reason,
    ).toBe('Christmas');
  });

  it('reads a closure back as the owner would say it', async () => {
    const one = closeGym.sanitise({ starts_on: '2026-12-24', ends_on: '2026-12-24' })!;
    expect((await closeGym.preview(one, null as never)).title).toBe(
      'Close the gym on 24 December?',
    );
    const span = closeGym.sanitise({ starts_on: '2026-12-24', ends_on: '2027-01-03' })!;
    expect((await closeGym.preview(span, null as never)).title).toBe(
      'Close the gym 24 December to 3 January?',
    );
  });

  it('passes new classes and new plans to the setup sanitisers', () => {
    expect(
      addClasses.sanitise({
        schedules: [{ class_type: 'Spin', days: [3], times: ['07:00'] }],
      })?.proposal.schedules[0].capacity,
    ).toBe(16);
    expect(addClasses.sanitise({ schedules: [] })).toBeNull();
    expect(
      addPlans.sanitise({
        plans: [{ name: 'Off-peak', kind: 'unlimited', monthly_price_cents: 5900 }],
      })?.proposal.plans[0].name,
    ).toBe('Off-peak');
    expect(addPlans.sanitise({ plans: 'an off-peak one' })).toBeNull();
  });

  it('will not draft a newsletter with no sections', () => {
    expect(
      draftNewsletter.sanitise({
        newsletter: {
          subject: 'Christmas hours',
          sections: [{ heading: 'We are shut', body: 'From the 24th to the 28th.' }],
        },
      })?.draft.subject,
    ).toBe('Christmas hours');
    expect(
      draftNewsletter.sanitise({ newsletter: { subject: 'Hello', sections: [] } }),
    ).toBeNull();
  });
});

describe('classes.edit', () => {
  it('needs something to actually change', () => {
    expect(editClasses.sanitise({ days: [6], capacity: 20 })?.req).toMatchObject({
      days: [6],
      capacity: 20,
      shiftMinutes: null,
    });
    expect(editClasses.sanitise({ days: [6] })).toBeNull();
    expect(editClasses.sanitise({ days: [6], shift_minutes: 0 })).toBeNull();
  });

  it('refuses a capacity or a shift outside what the bulk editor allows', () => {
    expect(editClasses.sanitise({ capacity: 5000 })).toBeNull();
    expect(editClasses.sanitise({ shift_minutes: 900 })).toBeNull();
    expect(editClasses.sanitise({ shift_minutes: -30 })?.req.shiftMinutes).toBe(-30);
  });
});

describe('members.find', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('takes a name, and a pick-list answer instead of one', () => {
    expect(findMember.sanitise({ query: 'Marcus' })).toEqual({
      query: 'Marcus',
      profileId: null,
    });
    // What the disambiguation chips send back.
    expect(findMember.sanitise({ profile_id: id, query: 'Marcus Webb' })).toEqual({
      profileId: id,
      query: 'Marcus Webb',
    });
  });

  it('ignores anything that is not really an id, and needs a name if so', () => {
    expect(findMember.sanitise({ profile_id: 'the first one', query: 'Marcus' })).toEqual({
      query: 'Marcus',
      profileId: null,
    });
    expect(findMember.sanitise({ profile_id: 'the first one' })).toBeNull();
    expect(findMember.sanitise({ query: 'M' })).toBeNull();
    expect(findMember.sanitise({})).toBeNull();
  });

  it('is a question, so it never applies anything', () => {
    expect(findMember.kind).toBe('ask');
    expect(findMember.apply).toBeUndefined();
  });
});

describe('matchProduct', () => {
  const shop = [
    { name: 'Temple Water Bottle 750ml' },
    { name: 'Hoodie' },
    { name: 'Technique Guide' },
  ];

  it('finds what the owner called it, not what it was typed as', () => {
    expect(matchProduct(shop, 'water bottle')?.name).toBe(
      'Temple Water Bottle 750ml',
    );
    expect(matchProduct(shop, 'the hoodie')?.name).toBe('Hoodie');
  });

  it('refuses to pick between two that both answer to it', () => {
    const two = [{ name: 'Small bottle' }, { name: 'Large bottle' }];
    expect(matchProduct(two, 'bottle')).toBeNull();
  });

  it('returns nothing when nothing matches', () => {
    expect(matchProduct(shop, 'protein')).toBeNull();
  });
});
