import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bookMemberIn,
  cancelClass,
  editClasses,
  moveClass,
  removeMemberFrom,
  setClassCoach,
} from './classes';
import {
  audienceFrom,
  cancelSend,
  stopSend,
  describeSequenceAction,
  newsletterCard,
  readAudienceArgs,
  scheduleSend,
  sendReportAction,
  sequenceCard,
} from './comms';
import { sanitiseSequence } from '../sequence-draft';
import { addClasses, addPlans, changeRules, closeGym, draftNewsletter } from './gym';
import { classAttendance } from './classes';
import { ACTIONS, actionsFor, findAction } from './index';
import { addLead, assignLeadTo, leadPipeline, moveLead } from './leads';
import {
  assignPlan,
  compMember,
  findMember,
  messageMember,
  quietMembers,
  tagMember,
} from './members';
import { moneySummary, periodLabel, refundMember, setPlanPrice } from './money';
import {
  blockOut,
  dropBlock,
  moveBlock,
  setPlanProgramming,
  setProgrammingAccess,
  whoIsProgrammed,
} from './programming';
import {
  addStoreProduct,
  matchProduct,
  refundStoreOrder,
  setStoreProductPrice,
  storeSales,
} from './store';
import {
  addTagRule,
  inviteToTeam,
  removeFromTeam,
  rosterFailure,
  setTeamRole,
  whoIsOnTheTeam,
} from './team';
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
        'comms.describe_sequence',
        'classes.edit',
        'classes.cancel',
        'classes.book_member',
        'classes.remove_member',
        'members.find',
        'members.assign_plan',
        'members.comp',
        'members.tag',
        'members.message',
        'leads.add',
        'leads.set_status',
        'leads.assign',
        'leads.pipeline',
        'money.summary',
        'money.set_plan_price',
        'money.refund',
        'programming.block_out',
        'programming.move_block',
        'programming.drop_block',
        'programming.set_access',
        'programming.who_is_programmed',
        'plans.include_programming',
        'team.invite',
        'team.who',
        'tags.add_rule',
        'store.add_product',
        'store.set_price',
        'store.sales',
        'system.find_screen',
        'usage.what_nobody_opens',
      ]),
    );
  });

  // The bar's worst failure is answering "I can't do that" when there is a
  // screen for it and only the sentence is missing. find_screen is the
  // fallback that turns that into a door, so it has to be reachable by
  // anybody who can be on a staff screen at all — and no wider.
  it('offers the way to a screen to anybody staff-side', () => {
    const staff = actionsFor((c) => c === 'can_access_staff_area').map(
      (a) => a.name,
    );
    expect(staff).toContain('system.find_screen');
    // The same gate members.find, members.message and team.who already use
    // — the things anybody working a shift can ask.
    expect(staff.sort()).toEqual([
      'members.find',
      'members.message',
      'system.find_screen',
      'team.who',
    ]);
    // And no wider: the usage question is an admin deciding what to keep.
    expect(staff).not.toContain('usage.what_nobody_opens');
  });
});

// An invalidate key that names no real query is a write whose screens never
// refresh — and it fails silently, which is how four of them went unnoticed.
// So the list is checked against the app's own queryKey literals.
describe('what each action says it staled', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  it('names queries that actually exist', () => {
    const keys = new Set<string>();
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/queryKey:\s*\[\s*'([a-z0-9-]+)'/g)) {
        keys.add(m[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(50);
    const unknown = ACTIONS.flatMap((a) => a.invalidate ?? []).filter(
      (k) => !keys.has(k),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every write something to refresh', () => {
    for (const a of ACTIONS) {
      if (a.kind === 'do') expect((a.invalidate ?? []).length).toBeGreaterThan(0);
    }
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
    const preview = await addStoreProduct.preview(args, {
      currency: 'GBP',
    } as never);
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

describe('putting a member on a plan', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('needs both a person and a plan', () => {
    expect(assignPlan.sanitise({ member: 'Marcus', plan: 'Unlimited' })).toEqual({
      member: 'Marcus',
      plan: 'Unlimited',
      until: null,
      mode: null,
      profileId: null,
      pendingId: null,
    });
    expect(assignPlan.sanitise({ member: 'Marcus' })).toBeNull();
    expect(assignPlan.sanitise({ plan: 'Unlimited' })).toBeNull();
    expect(assignPlan.sanitise({})).toBeNull();
  });

  it('takes an end date only when it is a real one', () => {
    expect(
      assignPlan.sanitise({ member: 'Marcus', plan: 'Unlimited', until: '2027-03-31' })?.until,
    ).toBe('2027-03-31');
    // "the end of March" never reaches sanitise as prose, but if it did it
    // must not become an end date.
    expect(
      assignPlan.sanitise({ member: 'Marcus', plan: 'Unlimited', until: 'end of March' })?.until,
    ).toBeNull();
  });

  // The card asks "move them or add it as well" and the chips answer. A
  // mode the model invented is not an answer.
  it('only accepts a mode the card offered', () => {
    expect(
      assignPlan.sanitise({ member: 'M', plan: 'U', mode: 'move' })?.mode,
    ).toBe('move');
    expect(assignPlan.sanitise({ member: 'M', plan: 'U', mode: 'add' })?.mode).toBe('add');
    expect(assignPlan.sanitise({ member: 'M', plan: 'U', mode: 'replace' })?.mode).toBeNull();
    expect(assignPlan.sanitise({ member: 'M', plan: 'U' })?.mode).toBeNull();
  });

  it('carries the ids the chips send and ignores anything that is not one', () => {
    const picked = assignPlan.sanitise({ member: 'Marcus Webb', plan: 'U', profile_id: id });
    expect(picked?.profileId).toBe(id);
    expect(assignPlan.sanitise({ member: 'M', plan: 'U', pending_id: id })?.pendingId).toBe(id);
    expect(
      assignPlan.sanitise({ member: 'M', plan: 'U', profile_id: 'the first one' })?.profileId,
    ).toBeNull();
  });
});

describe('comping', () => {
  it('defaults to a month and takes a count of classes when one was said', () => {
    expect(compMember.sanitise({ member: 'Sarah' })).toEqual({
      member: 'Sarah',
      days: null,
      credits: null,
      reason: null,
      profileId: null,
      pendingId: null,
    });
    expect(compMember.sanitise({ member: 'Sarah', days: 14 })?.days).toBe(14);
    expect(compMember.sanitise({ member: 'Sarah', credits: 5 })?.credits).toBe(5);
    expect(compMember.sanitise({ member: 'Sarah', reason: ' injured ' })?.reason).toBe('injured');
  });

  it('refuses a window or a count it would have to invent', () => {
    // Out of range falls back to the default rather than comping someone
    // for three years by accident.
    expect(compMember.sanitise({ member: 'Sarah', days: 5000 })?.days).toBeNull();
    expect(compMember.sanitise({ member: 'Sarah', credits: 0 })?.credits).toBeNull();
    expect(compMember.sanitise({ member: 'Sarah', credits: 9999 })?.credits).toBeNull();
    expect(compMember.sanitise({})).toBeNull();
  });
});

describe('tagging and messaging one member', () => {
  it('needs a person and a label, and keeps tags staff-only unless told', () => {
    expect(tagMember.sanitise({ member: 'Jo', label: 'injured' })).toEqual({
      member: 'Jo',
      label: 'injured',
      memberVisible: false,
      profileId: null,
      pendingId: null,
    });
    expect(tagMember.sanitise({ member: 'Jo', label: 'injured', visible: true })?.memberVisible)
      .toBe(true);
    // Anything other than a real true stays staff-only.
    expect(tagMember.sanitise({ member: 'Jo', label: 'injured', visible: 'yes' })?.memberVisible)
      .toBe(false);
    expect(tagMember.sanitise({ member: 'Jo' })).toBeNull();
  });

  it('will not send an empty message', () => {
    expect(messageMember.sanitise({ member: 'Marcus', body: 'Your 6am moved' })?.body).toBe(
      'Your 6am moved',
    );
    expect(messageMember.sanitise({ member: 'Marcus', body: '   ' })).toBeNull();
    expect(messageMember.sanitise({ member: 'Marcus' })).toBeNull();
  });
});

describe('classes on the calendar', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('takes a day and a time only when they are real ones', () => {
    expect(cancelClass.sanitise({ day: '2026-08-14', time: '06:00' })).toMatchObject({
      day: '2026-08-14',
      time: '06:00',
      series: false,
    });
    // Prose that reached sanitise must not become a date or a clock time.
    expect(cancelClass.sanitise({ day: 'tomorrow', time: '6am' })).toMatchObject({
      day: null,
      time: null,
    });
    expect(cancelClass.sanitise({ time: '25:00' })?.time).toBeNull();
  });

  // Naming nothing is legitimate — "cancel the barbell club" when there is
  // only one coming up — so this one never refuses on shape.
  it('accepts a class named only by kind', () => {
    expect(cancelClass.sanitise({ class_type: 'spin' })).toMatchObject({
      classType: 'spin',
      day: null,
      time: null,
    });
  });

  it('only cancels a series when that was actually said', () => {
    expect(cancelClass.sanitise({ day: '2026-08-14', series: true })?.series).toBe(true);
    expect(cancelClass.sanitise({ day: '2026-08-14' })?.series).toBe(false);
    expect(cancelClass.sanitise({ day: '2026-08-14', series: 'yes' })?.series).toBe(false);
  });

  it('needs a person before it will book or unbook one', () => {
    expect(bookMemberIn.sanitise({ member: 'Marcus', day: '2026-08-14' })).toMatchObject({
      member: 'Marcus',
      mode: null,
    });
    expect(bookMemberIn.sanitise({ day: '2026-08-14' })).toBeNull();
    expect(removeMemberFrom.sanitise({ day: '2026-08-14' })).toBeNull();
  });

  // The chips answer the two questions the cards ask; a mode or a refund
  // flag the model invented is not an answer.
  it('only accepts the answers its own cards offered', () => {
    expect(bookMemberIn.sanitise({ member: 'M', mode: 'over_capacity' })?.mode).toBe(
      'over_capacity',
    );
    expect(bookMemberIn.sanitise({ member: 'M', mode: 'waitlist' })?.mode).toBe('waitlist');
    expect(bookMemberIn.sanitise({ member: 'M', mode: 'force' })?.mode).toBeNull();

    expect(removeMemberFrom.sanitise({ member: 'S', refund: true })?.refund).toBe(true);
    expect(removeMemberFrom.sanitise({ member: 'S', refund: false })?.refund).toBe(false);
    // Unanswered stays unanswered — the card asks rather than assuming.
    expect(removeMemberFrom.sanitise({ member: 'S' })?.refund).toBeNull();
    expect(removeMemberFrom.sanitise({ member: 'S', refund: 'yes' })?.refund).toBeNull();
  });

  it('carries the ids its chips send, and ignores anything that is not one', () => {
    expect(
      bookMemberIn.sanitise({ member: 'M', profile_id: id, session_id: id }),
    ).toMatchObject({ profileId: id, sessionId: id });
    expect(
      bookMemberIn.sanitise({ member: 'M', session_id: 'the 6am one' })?.sessionId,
    ).toBeNull();
  });
});

describe('what the gym took', () => {
  it('takes a period only when both ends were named', () => {
    expect(moneySummary.sanitise({ from: '2026-07-01', to: '2026-07-31' })).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      defaulted: false,
    });
  });

  // Half a period is not a period. Pairing a stated start with today would
  // answer a question nobody asked, and the number would look right.
  it('falls back to thirty days rather than inventing the other end', () => {
    expect(moneySummary.sanitise({ from: '2026-07-01' })?.defaulted).toBe(true);
    expect(moneySummary.sanitise({ to: '2026-07-31' })?.defaulted).toBe(true);
    expect(moneySummary.sanitise({})?.defaulted).toBe(true);
    expect(moneySummary.sanitise({ from: 'last month', to: 'now' })?.defaulted).toBe(true);
    // Backwards is not a period either.
    expect(
      moneySummary.sanitise({ from: '2026-07-31', to: '2026-07-01' })?.defaulted,
    ).toBe(true);
  });

  it('reads the period back the way it was asked for', () => {
    expect(periodLabel({ from: '2026-07-01', to: '2026-07-31' }, false)).toBe(
      '1 to 31 July 2026',
    );
    expect(periodLabel({ from: '2026-06-28', to: '2026-07-04' }, false)).toBe(
      '28 June 2026 to 4 July 2026',
    );
    expect(periodLabel({ from: '2026-07-04', to: '2026-07-04' }, false)).toBe(
      'on 4 July 2026',
    );
    expect(periodLabel({ from: '2026-07-01', to: '2026-07-31' }, true)).toBe(
      'in the last 30 days',
    );
  });

  it('is a question, so it never writes', () => {
    expect(moneySummary.kind).toBe('ask');
    expect(moneySummary.apply).toBeUndefined();
  });
});

describe('changing what a plan costs', () => {
  it('needs a plan and a price it can read as money', () => {
    expect(setPlanPrice.sanitise({ plan: 'Unlimited', price: '£60' })).toEqual({
      plan: 'Unlimited',
      cents: 6000,
    });
    expect(setPlanPrice.sanitise({ plan: 'Off-peak', price: 35.5 })?.cents).toBe(3550);
    expect(setPlanPrice.sanitise({ plan: 'Unlimited' })).toBeNull();
    expect(setPlanPrice.sanitise({ price: 60 })).toBeNull();
  });

  // A third decimal place is somebody's price being silently rounded.
  it('refuses a price it would have to round', () => {
    expect(setPlanPrice.sanitise({ plan: 'Unlimited', price: '59.999' })).toBeNull();
    expect(setPlanPrice.sanitise({ plan: 'Unlimited', price: 'sixty quid' })).toBeNull();
  });

  it('is free, which is a price', () => {
    expect(setPlanPrice.sanitise({ plan: 'Intro', price: 0 })?.cents).toBe(0);
  });
});

describe('refunding a member', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('needs only a person, and emails them unless told not to', () => {
    expect(refundMember.sanitise({ member: 'Marcus' })).toEqual({
      member: 'Marcus',
      mode: null,
      amountCents: null,
      notify: true,
      profileId: null,
      pendingId: null,
    });
    expect(refundMember.sanitise({ member: 'Marcus', notify: false })?.notify).toBe(false);
    expect(refundMember.sanitise({})).toBeNull();
  });

  // Four refunds hide behind "refund Marcus" and they differ by tens of
  // pounds and by whether he can train tomorrow. The card asks; the model
  // is never shown the question, so it cannot answer it.
  it('never lets the parser choose the kind of refund', () => {
    expect(refundMember.args.map((a) => a.name)).not.toContain('mode');
    expect(refundMember.sanitise({ member: 'M', mode: 'full_revoke' })?.mode).toBe(
      'full_revoke',
    );
    expect(refundMember.sanitise({ member: 'M', mode: 'everything' })?.mode).toBeNull();
    expect(refundMember.sanitise({ member: 'M' })?.mode).toBeNull();
  });

  it('takes a named goodwill amount and the id a chip sends', () => {
    expect(refundMember.sanitise({ member: 'Dan', amount: '£20' })?.amountCents).toBe(2000);
    expect(refundMember.sanitise({ member: 'Dan', amount: 'some of it' })?.amountCents).toBeNull();
    expect(refundMember.sanitise({ member: 'Dan', profile_id: id })?.profileId).toBe(id);
    expect(
      refundMember.sanitise({ member: 'Dan', profile_id: 'the first one' })?.profileId,
    ).toBeNull();
  });
});

describe('who a newsletter is for', () => {
  it('reads tags and cohorts off the sentence, and everybody by default', () => {
    expect(readAudienceArgs({ tags: ['injured'] })).toEqual({
      tags: ['injured'],
      cohorts: [],
    });
    expect(readAudienceArgs({ cohorts: ['expired'] })).toEqual({
      tags: [],
      cohorts: ['expired'],
    });
    expect(readAudienceArgs({})).toEqual({ tags: [], cohorts: [] });
    // Whatever the model felt like sending is not a tag list.
    expect(readAudienceArgs({ tags: 'injured' }).tags).toEqual([]);
    expect(readAudienceArgs({ tags: [1, null, 'ok'] }).tags).toEqual(['ok']);
  });

  // Naming a tag is more specific than naming a group, so a sentence that
  // does both means the tag.
  it('prefers a tag over a cohort, and drops a cohort it does not know', () => {
    expect(audienceFrom(['injured'], ['expired'])).toEqual({
      kind: 'tags',
      tags: ['injured'],
    });
    expect(audienceFrom([], ['expired'])).toEqual({
      kind: 'cohort',
      cohorts: ['expired'],
    });
    expect(audienceFrom([], ['lapsed'])).toEqual({ kind: 'all_members' });
    expect(audienceFrom([], [])).toEqual({ kind: 'all_members' });
  });

  it('offers the audience to the parser as part of the newsletter', () => {
    const names = draftNewsletter.args.map((a) => a.name);
    expect(names).toContain('tags');
    expect(names).toContain('cohorts');
  });
});

describe('describing a sequence', () => {
  const ok = {
    sequence: {
      name: 'Welcome',
      trigger: 'member_joined',
      emails: [
        {
          after_days: 0,
          subject: 'Welcome to Temple',
          heading: 'You are in',
          body: 'Great to have you with us.',
        },
      ],
    },
  };

  it('takes a sequence it can actually build', () => {
    const a = describeSequenceAction.sanitise(ok);
    expect(a?.draft.name).toBe('Welcome');
    expect(a?.draft.emails).toHaveLength(1);
  });

  it('refuses one it would have to invent the trigger for', () => {
    expect(
      describeSequenceAction.sanitise({
        sequence: { ...ok.sequence, trigger: undefined },
      }),
    ).toBeNull();
    expect(describeSequenceAction.sanitise({})).toBeNull();
  });

  // The one promise on the card that has to hold: describing a program is
  // drafting it, turning it on is a human act.
  it('never sets enabled, so it can only arrive switched off', () => {
    const src = readFileSync('src/lib/actions/comms.ts', 'utf8');
    expect(src).not.toMatch(/enabled\s*:/);
  });
});

// brandOf is the only read either card makes, and a gym with no branding
// set is the shape that must not crash — every colour has a fallback.
const NO_BRAND = {
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null }),
          maybeSingle: async () =>
            table === 'gym_comms_settings'
              ? {
                  data: {
                    footer_business_name: 'Temple Strength Ltd',
                    footer_address: '14 Rivington St, London',
                  },
                }
              : { data: null },
        }),
      }),
    }),
  },
  gymId: 'gym',
  userId: 'user',
} as never;

describe('the draft, in the chat', () => {
  it('renders a newsletter as one email with who it is for and no timing', async () => {
    const card = await newsletterCard(
      {
        subject: 'Rehab class starts Monday',
        sections: [{ heading: 'What it is', body: 'A small-group session.' }],
      },
      'To Injured — 14 people.',
      NO_BRAND,
    );
    expect(card.audience).toBe('To Injured — 14 people.');
    expect(card.emails).toHaveLength(1);
    expect(card.emails[0].when).toBeNull();
    expect(card.emails[0].subject).toBe('Rehab class starts Monday');
    // Full text, not the 90-character truncation the card used to show —
    // whether the wording is any good is the whole question.
    expect(card.emails[0].sections[0].body).toBe('A small-group session.');
    expect(card.note).toBeNull();
    expect(card.primaryColor).toBe('#2563EB');
    expect(card.gymName).toBe('Your gym');
    // Not a rendering of the draft — the draft. Same builder apply uses,
    // so what the owner reads is what the send worker posts. The subject
    // lives on the campaign rather than in the body, which is why the card
    // shows it separately above the frame.
    expect(card.emails[0].html).toContain('What it is');
    expect(card.emails[0].html).toContain('A small-group session.');
    expect(card.emails[0].html).toMatch(/<html|<table/i);
    // Rendering the real thing is how this was found: the fallback used to
    // be white, so the body text was white on the white content panel.
    expect(card.emails[0].html).toContain(
      'color:#0F172A;text-align:left;">A small-group session.',
    );
  });

  it('renders a sequence as its steps, stamped with when each one goes', async () => {
    const draft = sanitiseSequence({
      name: 'Welcome',
      trigger: 'member_joined',
      emails: [
        { after_days: 0, subject: 'Welcome', heading: 'You are in', body: 'Good to have you.' },
        { after_days: 7, subject: 'Week one', heading: 'How is it going', body: 'Tell us how you got on.' },
      ],
    })!;
    const card = await sequenceCard(draft, NO_BRAND);
    expect(card.audience).toBe('Starts when someone joins the gym.');
    expect(card.emails.map((e) => e.when)).toEqual(['Straight away', 'A week later']);
    // Each step compiles to its own email, not one document with both.
    expect(card.emails[0].html).toContain('You are in');
    expect(card.emails[0].html).not.toContain('How is it going');
    // The one thing the owner must not discover later.
    expect(card.note).toContain('switched off');
  });
});

// An action that navigated on the owner's behalf would empty the
// conversation they were in the middle of, which is the thing this whole
// surface exists to stop. Actions offer; the receipt carries the chip.
describe('nothing walks the owner out of the chat', () => {
  it('has no navigation anywhere in the registry', () => {
    for (const file of readdirSync('src/lib/actions')) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = readFileSync(join('src/lib/actions', file), 'utf8');
      expect(src).not.toMatch(/router\.(push|replace)|ctx\.navigate/);
    }
  });
});

describe('the enquiries', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('takes an enquiry with only a name, and keeps what else was said', () => {
    expect(addLead.sanitise({ name: 'Sarah Jones' })).toEqual({
      name: 'Sarah Jones',
      email: null,
      phone: null,
      source: null,
      notes: null,
    });
    const full = addLead.sanitise({
      name: 'Dan Webb',
      email: 'dan@example.com',
      phone: '07700 900123',
      source: 'Instagram',
      notes: 'wants evenings',
    });
    expect(full?.email).toBe('dan@example.com');
    expect(full?.source).toBe('Instagram');
    expect(addLead.sanitise({ email: 'nobody@example.com' })).toBeNull();
  });

  it('only moves an enquiry to a stage the pipeline has', () => {
    expect(moveLead.sanitise({ lead: 'Sarah', status: 'intro_booked' })).toEqual({
      lead: 'Sarah',
      status: 'intro_booked',
      leadId: null,
    });
    expect(moveLead.sanitise({ lead: 'Sarah', status: 'warm' })).toBeNull();
    expect(moveLead.sanitise({ lead: 'Sarah' })).toBeNull();
    expect(moveLead.sanitise({ status: 'lost' })).toBeNull();
  });

  // set_lead_status refuses `converted` without a member profile, because a
  // conversion is a link to a real account rather than a label. A verb that
  // could only ever fail is worse than no verb.
  it('never offers converted, which needs a member account', () => {
    const arg = moveLead.args.find((a) => a.name === 'status')!;
    expect(arg.values).not.toContain('converted');
    expect(moveLead.sanitise({ lead: 'Sarah', status: 'converted' })).toBeNull();
  });

  it('carries the id a disambiguation chip sends, and ignores a fake one', () => {
    expect(
      moveLead.sanitise({ lead: 'Sarah Jones', status: 'contacted', lead_id: id })?.leadId,
    ).toBe(id);
    expect(
      moveLead.sanitise({ lead: 'Sarah', status: 'contacted', lead_id: 'the first' })?.leadId,
    ).toBeNull();
  });

  it('needs both halves of a handover', () => {
    expect(assignLeadTo.sanitise({ lead: 'Sarah', coach: 'Marcus' })).toEqual({
      lead: 'Sarah',
      coach: 'Marcus',
      leadId: null,
    });
    expect(assignLeadTo.sanitise({ lead: 'Sarah' })).toBeNull();
    expect(assignLeadTo.sanitise({ coach: 'Marcus' })).toBeNull();
  });

  it('defaults the pipeline question to a week', () => {
    expect(leadPipeline.sanitise({})).toEqual({ days: 7 });
    expect(leadPipeline.sanitise({ days: 30 })).toEqual({ days: 30 });
    expect(leadPipeline.sanitise({ days: 9999 })).toEqual({ days: 7 });
    expect(leadPipeline.sanitise({ days: 'this week' })).toEqual({ days: 7 });
  });

  it('is a question, so it never writes', () => {
    expect(leadPipeline.kind).toBe('ask');
    expect(leadPipeline.apply).toBeUndefined();
  });
});

describe('the team', () => {
  it('needs a real email, and defaults the role to coach', () => {
    expect(inviteToTeam.sanitise({ email: 'Sam@Example.com ' })).toEqual({
      email: 'sam@example.com',
      role: 'coach',
    });
    expect(inviteToTeam.sanitise({ email: 'sam@example.com', role: 'staff' })?.role).toBe(
      'staff',
    );
    expect(inviteToTeam.sanitise({ email: 'sam' })).toBeNull();
    expect(inviteToTeam.sanitise({ email: 'sam at example dot com' })).toBeNull();
    expect(inviteToTeam.sanitise({})).toBeNull();
  });

  // The database would let an owner mint another owner. Handing your gym
  // to somebody is still not a thing to do by saying a sentence, so it is
  // left off the vocabulary and a request for it falls back to coach.
  it('never offers to mint an owner', () => {
    const arg = inviteToTeam.args.find((a) => a.name === 'role')!;
    expect(arg.values).not.toContain('owner');
    expect(inviteToTeam.sanitise({ email: 'a@b.co', role: 'owner' })?.role).toBe('coach');
  });

  it('asks who is here without needing anything said', () => {
    expect(whoIsOnTheTeam.sanitise({})).toEqual({});
    expect(whoIsOnTheTeam.kind).toBe('ask');
    expect(whoIsOnTheTeam.apply).toBeUndefined();
  });
});

describe('tag rules', () => {
  it('needs a label and a predicate it recognises', () => {
    expect(addTagRule.sanitise({ label: 'New', predicate: 'intro' })).toEqual({
      label: 'New',
      predicate: 'intro',
      days: null,
      plan: null,
    });
    expect(addTagRule.sanitise({ label: 'New', predicate: 'rich' })).toBeNull();
    expect(addTagRule.sanitise({ predicate: 'intro' })).toBeNull();
  });

  // The table's CHECK refuses these two without a number, so a rule the
  // database would reject must never reach a confirm card.
  it('refuses a threshold rule with no number', () => {
    expect(addTagRule.sanitise({ label: 'Ghosting', predicate: 'no_recent_attendance' })).toBeNull();
    expect(addTagRule.sanitise({ label: 'Fresh', predicate: 'joined_within' })).toBeNull();
    expect(
      addTagRule.sanitise({ label: 'Ghosting', predicate: 'no_recent_attendance', days: 30 })?.days,
    ).toBe(30);
  });

  it('refuses an on_plan rule with no plan, and drops a plan that means nothing', () => {
    expect(addTagRule.sanitise({ label: 'Gold', predicate: 'on_plan' })).toBeNull();
    expect(
      addTagRule.sanitise({ label: 'Gold', predicate: 'on_plan', plan: 'Unlimited' })?.plan,
    ).toBe('Unlimited');
    // A plan named alongside a predicate that takes no plan would violate
    // the same CHECK from the other side.
    expect(addTagRule.sanitise({ label: 'New', predicate: 'intro', plan: 'Unlimited' })?.plan)
      .toBeNull();
    expect(addTagRule.sanitise({ label: 'New', predicate: 'intro', days: 30 })?.days).toBeNull();
  });

  // Resolving a class type is a second name to get wrong, and the screen
  // does it better. Left off the enum rather than half-supported.
  it('does not offer the predicates that need a class type', () => {
    const arg = addTagRule.args.find((a) => a.name === 'predicate')!;
    expect(arg.values).not.toContain('booked_class_type');
    expect(arg.values).not.toContain('attended_class_type');
  });
});

describe('the year plan', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const ok = { name: 'Open prep', starts_on: '2027-01-06', ends_on: '2027-03-15' };

  // The table's own CHECKs (0205): 2-60 characters, end on or after start.
  // A row the database would reject must never become a confirm card.
  it('holds itself to the same bounds the table does', () => {
    expect(blockOut.sanitise(ok)).toEqual({
      name: 'Open prep',
      startsOn: '2027-01-06',
      endsOn: '2027-03-15',
      note: null,
    });
    expect(blockOut.sanitise({ ...ok, name: 'X' })).toBeNull();
    expect(blockOut.sanitise({ ...ok, ends_on: '2027-01-05' })).toBeNull();
    expect(blockOut.sanitise({ ...ok, starts_on: 'early January' })).toBeNull();
    expect(blockOut.sanitise({ name: 'Open prep' })).toBeNull();
  });

  it('takes a one-day block, which is a real thing to want', () => {
    expect(
      blockOut.sanitise({ ...ok, starts_on: '2027-01-06', ends_on: '2027-01-06' })?.endsOn,
    ).toBe('2027-01-06');
  });

  // An empty confirm card is worse than being told there was nothing in
  // the sentence to act on.
  it('refuses a change that changes nothing', () => {
    expect(moveBlock.sanitise({ block: 'Open prep' })).toBeNull();
    expect(moveBlock.sanitise({ block: 'Open prep', starts_on: '2027-02-01' })?.startsOn).toBe(
      '2027-02-01',
    );
    expect(moveBlock.sanitise({ block: 'Open prep', name: 'Recovery' })?.name).toBe('Recovery');
    expect(moveBlock.sanitise({ block: 'Open prep', name: 'R' })).toBeNull();
  });

  it('carries the id a chip sends and ignores a fake one', () => {
    expect(
      moveBlock.sanitise({ block: 'Open prep', name: 'Recovery', block_id: id })?.blockId,
    ).toBe(id);
    expect(dropBlock.sanitise({ block: 'Open prep', block_id: 'the first' })?.blockId).toBeNull();
    expect(dropBlock.sanitise({})).toBeNull();
  });
});

describe('individual programming', () => {
  // set_member_programming_access refuses paid with no product, so the
  // card is never built for a request that could only fail.
  it('will not charge somebody without saying what they buy', () => {
    expect(setProgrammingAccess.sanitise({ member: 'Marcus', mode: 'paid' })).toBeNull();
    expect(
      setProgrammingAccess.sanitise({ member: 'Marcus', mode: 'paid', product: 'PT block' })
        ?.product,
    ).toBe('PT block');
    expect(setProgrammingAccess.sanitise({ member: 'Marcus', mode: 'free' })).toEqual({
      member: 'Marcus',
      mode: 'free',
      product: null,
      profileId: null,
    });
    // A product named alongside free means nothing and is dropped.
    expect(
      setProgrammingAccess.sanitise({ member: 'M', mode: 'free', product: 'PT block' })?.product,
    ).toBeNull();
    expect(setProgrammingAccess.sanitise({ member: 'M', mode: 'cheap' })).toBeNull();
  });

  it('is a question, so it never writes', () => {
    expect(whoIsProgrammed.sanitise({})).toEqual({});
    expect(whoIsProgrammed.kind).toBe('ask');
    expect(whoIsProgrammed.apply).toBeUndefined();
  });

  it('needs a plan and an explicit yes or no', () => {
    expect(setPlanProgramming.sanitise({ plan: 'Unlimited', included: true })).toEqual({
      plan: 'Unlimited',
      included: true,
    });
    expect(setPlanProgramming.sanitise({ plan: 'Unlimited', included: false })?.included).toBe(
      false,
    );
    // "true" is not true — a string here would flip the wrong way round.
    expect(setPlanProgramming.sanitise({ plan: 'Unlimited', included: 'true' })).toBeNull();
    expect(setPlanProgramming.sanitise({ plan: 'Unlimited' })).toBeNull();
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

// The owner's condition for allowing a send to be approved now and go
// later was that the card show what is being approved: the real email,
// who it reaches, and the exact time.
describe('scheduling a send', () => {
  const ok = {
    newsletter: {
      subject: 'Christmas hours',
      sections: [{ heading: 'We are open', body: 'Every day but the 25th.' }],
    },
    send_on: '2026-12-20',
    send_time: '09:00',
  };

  it('takes a draft with a day and an hour', () => {
    const a = scheduleSend.sanitise(ok);
    expect(a?.draft.subject).toBe('Christmas hours');
    expect(a?.when).toEqual({ y: 2026, mo: 12, d: 20, h: 9, mi: 0 });
  });

  // A newsletter with no time is comms.draft_newsletter. Sending "now"
  // because the time did not parse is the one outcome nobody asked for.
  it('refuses rather than sending immediately when the time is unusable', () => {
    expect(scheduleSend.sanitise({ ...ok, send_time: 'in the morning' })).toBeNull();
    expect(scheduleSend.sanitise({ ...ok, send_time: undefined })).toBeNull();
    expect(scheduleSend.sanitise({ ...ok, send_on: undefined })).toBeNull();
    expect(scheduleSend.sanitise({ ...ok, newsletter: undefined })).toBeNull();
  });

  it('carries the audience the same way the newsletter does', () => {
    const a = scheduleSend.sanitise({ ...ok, tags: ['injured'] });
    expect(a?.audience.tags).toEqual(['injured']);
  });

  it('says what it staled, including the campaign it just wrote', () => {
    expect(scheduleSend.invalidate).toContain('comms-campaigns');
    expect(scheduleSend.kind).toBe('do');
    expect(scheduleSend.capability).toBe('can_manage_comms');
  });
});

// The condition was that the card show what is being approved. It was
// showing an email two lines shorter than the one that lands: the card
// compiled with no render context while the write compiled with the
// gym's real footer, so the business name and postal address — the two
// things a marketing email is legally obliged to carry — were on one and
// not the other.
describe('the card is the email that lands', () => {
  it('compiles the footer the write compiles', async () => {
    const card = await newsletterCard(
      { subject: 'Hours', sections: [{ heading: 'Open', body: 'All week.' }] },
      'To all members — 84 people.',
      NO_BRAND,
    );
    expect(card.emails[0].html).toContain('Temple Strength Ltd');
    expect(card.emails[0].html).toContain('14 Rivington St, London');
    // The one deliberate difference: the worker substitutes a
    // per-recipient link, and there is no per-recipient on a card.
    expect(card.emails[0].html).not.toContain('{{unsubscribe_url}}');
  });

  it('carries the time and the caveats when it is a scheduled send', async () => {
    const card = await newsletterCard(
      { subject: 'Hours', sections: [{ heading: 'Open', body: 'All week.' }] },
      'To all members — 84 people.',
      NO_BRAND,
      { when: 'Tuesday 4 August at 09:00 — in 3 days', note: 'Times are the gym’s.' },
    );
    expect(card.emails[0].when).toBe('Tuesday 4 August at 09:00 — in 3 days');
    expect(card.note).toBe('Times are the gym’s.');
  });
});

describe('calling a scheduled send off', () => {
  it('asks which when the words match more than one', async () => {
    const rows = [
      { id: 'a', title: 'Christmas hours', subject: 'Christmas hours', scheduled_for: null },
      { id: 'b', title: 'Christmas party', subject: 'Christmas party', scheduled_for: null },
    ];
    const ctx = {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ order: async () => ({ data: rows }) }),
            }),
          }),
        }),
      },
      gymId: 'gym',
      userId: 'user',
    } as never;
    const p = await cancelSend.preview({ which: 'christmas' }, ctx);
    expect(p.choices?.map((c) => c.label)).toEqual([
      'Christmas hours',
      'Christmas party',
    ]);
    expect(p.yes).toBeUndefined();
  });

  it('says nothing is waiting rather than cancelling the wrong thing', async () => {
    const ctx = {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }),
          }),
        }),
      },
      gymId: 'gym',
      userId: 'user',
    } as never;
    const p = await cancelSend.preview({ which: null }, ctx);
    expect(p.title).toBe('Nothing is waiting to go out.');
    expect(p.yes).toBeUndefined();
  });
});

// The two roster verbs. Both go through 0223's ladder, which is enforced
// in SQL — what is checked here is that the bar never confuses the two
// operations, because reading "he has left" as a role change is
// recoverable and reading it the other way is not.
describe('the roster, by sentence', () => {
  it('takes a person and a role, and knows the words people use', () => {
    expect(setTeamRole.sanitise({ who: 'Jo', role: 'admin' })).toEqual({
      who: 'Jo',
      role: 'admin',
    });
    expect(setTeamRole.sanitise({ who: 'Sam', role: 'staff' })?.role).toBe('staff');
    expect(setTeamRole.sanitise({ who: 'Dan', role: 'member' })?.role).toBe('member');
  });

  it('refuses a role that is not one of the five', () => {
    expect(setTeamRole.sanitise({ who: 'Jo', role: 'manager' })).toBeNull();
    expect(setTeamRole.sanitise({ who: 'Jo' })).toBeNull();
    expect(setTeamRole.sanitise({ role: 'admin' })).toBeNull();
  });

  it('keeps removal on its own verb, gated on its own switch', () => {
    expect(removeFromTeam.sanitise({ who: 'Marcus' })).toEqual({ who: 'Marcus' });
    expect(removeFromTeam.sanitise({})).toBeNull();
    expect(removeFromTeam.capability).toBe('can_archive_members');
    expect(setTeamRole.capability).toBe('can_manage_staff');
  });

  it('tells the owner which rule stopped them, in their own words', () => {
    const p = (msg: string) =>
      removeFromTeam.says && rosterFailure(msg);
    expect(p('A gym needs an owner — make someone else an owner first')).toMatch(
      /needs an owner/i,
    );
    expect(p('Only owners can remove owners or admins')).toMatch(/Only the owner/);
    expect(p('some postgres noise')).toBe("That didn't save — try again.");
  });
});

// The two class writes that never existed. Both resolve the new instant
// in the gym's timezone, so what is checked here is that the sanitiser
// refuses rather than degrades — a move whose time did not parse must not
// become a move to now.
describe('moving one class, and changing its coach', () => {
  const base = { day: '2026-08-04', time: '06:00' };

  it('takes a target day and time', () => {
    const a = moveClass.sanitise({ ...base, to_day: '2026-08-06', to_time: '18:30' });
    expect(a?.to).toEqual({ y: 2026, mo: 8, d: 6, h: 18, mi: 30 });
    expect(a?.day).toBe('2026-08-04');
    expect(a?.minutes).toBeNull();
  });

  it('takes a new length when they changed it', () => {
    expect(
      moveClass.sanitise({ ...base, to_day: '2026-08-06', to_time: '18:30', minutes: 75 })
        ?.minutes,
    ).toBe(75);
    // Out of range is dropped rather than clamped: a 2-minute class is a
    // typo and the RPC refuses it anyway.
    expect(
      moveClass.sanitise({ ...base, to_day: '2026-08-06', to_time: '18:30', minutes: 2 })
        ?.minutes,
    ).toBeNull();
  });

  it('refuses a move it cannot place', () => {
    expect(moveClass.sanitise({ ...base, to_day: '2026-08-06' })).toBeNull();
    expect(moveClass.sanitise({ ...base, to_time: '18:30' })).toBeNull();
    expect(moveClass.sanitise({ ...base, to_day: 'Thursday', to_time: '18:30' })).toBeNull();
    expect(moveClass.sanitise({ ...base, to_day: '2026-04-31', to_time: '18:30' })).toBeNull();
  });

  it('needs a named coach to reassign', () => {
    expect(setClassCoach.sanitise({ ...base, coach: 'Jo' })?.coach).toBe('Jo');
    expect(setClassCoach.sanitise(base)).toBeNull();
  });

  it('gates both on editing classes, not on covering them', () => {
    expect(moveClass.capability).toBe('can_edit_classes');
    expect(setClassCoach.capability).toBe('can_edit_classes');
  });
});

// The last of the four writes Temple did not have. The order is picked by
// what the owner said rather than by an id, so what matters here is that
// a vague sentence asks rather than guesses.
describe('refunding a shop order', () => {
  const rows = [
    {
      id: 'a',
      status: 'paid',
      total_cents: 3500,
      currency: 'GBP',
      created_at: '2026-07-20T10:00:00Z',
      fulfilled_at: null,
      has_physical: true,
      profiles: { full_name: 'Marcus Webb' },
      store_order_items: [{ name_snapshot: 'Hoodie', quantity: 1 }],
    },
    {
      id: 'b',
      status: 'fulfilled',
      total_cents: 800,
      currency: 'GBP',
      created_at: '2026-07-18T10:00:00Z',
      fulfilled_at: '2026-07-19T10:00:00Z',
      has_physical: true,
      profiles: { full_name: 'Marcus Webb' },
      store_order_items: [{ name_snapshot: 'Water bottle', quantity: 1 }],
    },
  ];
  const ctx = {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }),
          }),
        }),
      }),
    },
    gymId: 'gym',
    userId: 'user',
    currency: 'GBP',
  } as never;

  it('asks which order when the member bought more than one thing', async () => {
    const p = await refundStoreOrder.preview(
      { who: 'Marcus', what: null, amountCents: null },
      ctx,
    );
    expect(p.choices).toHaveLength(2);
    expect(p.yes).toBeUndefined();
  });

  it('says what happens to the stock, and it depends on whether it shipped', async () => {
    const unshipped = await refundStoreOrder.preview(
      { who: 'Marcus', what: 'Hoodie', amountCents: null },
      ctx,
    );
    expect(unshipped.lines.join(' ')).toMatch(/back on the shelf/);
    expect(unshipped.yes).toBe('Yes, refund it');

    const shipped = await refundStoreOrder.preview(
      { who: 'Marcus', what: 'Water bottle', amountCents: null },
      ctx,
    );
    expect(shipped.lines.join(' ')).toMatch(/not put back/);
  });

  it('takes a partial amount and says what is kept', async () => {
    const p = await refundStoreOrder.preview(
      { who: 'Marcus', what: 'Hoodie', amountCents: 1000 },
      ctx,
    );
    expect(p.title).toContain('£10');
    expect(p.lines.join(' ')).toMatch(/£25 stays with you/);
  });

  it('needs the same switch as a membership refund', () => {
    expect(refundStoreOrder.capability).toBe('can_refund');
  });
});

// Stopping a send has two halves and needs both. comms_stop_campaign
// marks the queued rows, but a worker mid-invocation holds its own copy
// of the queue in memory and would send the lot regardless — so the
// worker has to re-read the campaign's status as it goes. Grepped
// because it is the kind of thing a refactor drops silently, and the
// symptom is an email nobody could stop.
describe('a stopped send actually stops', () => {
  const worker = readFileSync('supabase/functions/send-campaign/index.ts', 'utf8');

  it('has the worker check before pulling each recipient', () => {
    expect(worker).toMatch(/if \(await shouldStop\(\)\) return;/);
  });

  it('reads the campaign status back rather than trusting its own copy', () => {
    expect(worker).toMatch(/from\('email_campaigns'\)[\s\S]{0,120}select\('status'\)/);
  });

  it('leaves a stopped campaign cancelled rather than sent', () => {
    // The final write is skipped entirely when stopped — claiming 'sent'
    // would say everyone got it and 'failed' would say nobody did.
    expect(worker).toMatch(/if \(!stopped\) \{/);
  });

  it('skips whatever the workers were still holding', () => {
    expect(worker).toMatch(/eq\('status', 'queued'\)/);
  });
});

describe('stopping a send, as a sentence', () => {
  it('is its own verb, separate from calling off a scheduled one', () => {
    expect(stopSend.name).toBe('comms.stop_send');
    expect(cancelSend.name).toBe('comms.cancel_send');
    expect(stopSend.capability).toBe('can_manage_comms');
  });

  it('does not need to be told which when there is only one', () => {
    expect(stopSend.sanitise({})).toEqual({ which: null });
    expect(stopSend.sanitise({ which: 'christmas' })).toEqual({ which: 'christmas' });
  });
});

// The gym's clock, not the device's.
//
// Every class action used to resolve "Friday's 7pm" through
// Intl.DateTimeFormat().resolvedOptions().timeZone — the phone's zone —
// and ask UTC what day it was. Both are the wrong question. A coach
// scheduling from a beach resolved a different hour from the one the
// members see, and near midnight UTC is a different day from the gym's,
// so "tomorrow's 6am" could land on a day nobody named.
//
// Grepped rather than unit-tested because the failure is invisible in
// the common case — same city, same clock — and only shows up for the
// one person who travelled.
describe('the class actions read the gym clock', () => {
  function actionSources(): string[] {
    return readdirSync('src/lib/actions')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join('src/lib/actions', f), 'utf8'));
  }

  it('never asks the device what timezone it is in', () => {
    for (const src of actionSources()) {
      expect(src).not.toMatch(/resolvedOptions\(\)\.timeZone/);
    }
  });

  it('never asks UTC what day it is', () => {
    for (const src of actionSources()) {
      expect(src).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
    }
  });
});

// The delivery webhook is the one endpoint in the codebase that a
// stranger could otherwise post to, and what it writes is "this address
// is dead, stop mailing it". A missing secret has to be a refusal, never
// a fallback to trusting the payload — grepped because the failure is
// silent and the blast radius is a gym's whole mailing list.
describe('the delivery webhook refuses anything unsigned', () => {
  const fn = readFileSync('supabase/functions/resend-webhook/index.ts', 'utf8');

  it('will not run without the secret', () => {
    expect(fn).toMatch(/!SECRET/);
    expect(fn).toMatch(/Function is not configured/);
  });

  it('verifies before it parses, so a bad payload is never read', () => {
    const verifyAt = fn.indexOf('await verify(');
    const parseAt = fn.indexOf('JSON.parse(raw)');
    expect(verifyAt).toBeGreaterThan(0);
    expect(parseAt).toBeGreaterThan(verifyAt);
  });

  it('holds the replay window rather than accepting any timestamp', () => {
    expect(fn).toMatch(/TOLERANCE_SECONDS/);
    expect(fn).toMatch(/age > TOLERANCE_SECONDS/);
  });

  it('compares signatures in constant time', () => {
    expect(fn).toMatch(/constantTimeEquals\(expected/);
  });
});

describe('asking how a send went', () => {
  it('is a question, not an instruction', () => {
    expect(sendReportAction.name).toBe('comms.send_report');
    expect(sendReportAction.kind).toBe('ask');
    expect(sendReportAction.capability).toBe('can_manage_comms');
    expect(sendReportAction.apply).toBeUndefined();
  });

  it('does not need to be told which one', () => {
    expect(sendReportAction.sanitise({})).toEqual({ which: null });
    expect(sendReportAction.sanitise({ which: 'christmas' })).toEqual({
      which: 'christmas',
    });
  });
});

// Phase 4: the bar answers about the gym, not only about one member.
// Both of these are questions — nothing they touch has an apply, and a
// question that could write would be the worst kind of surprise.
describe('asking about the gym', () => {
  it('are questions, gated on the register', () => {
    expect(classAttendance.kind).toBe('ask');
    expect(quietMembers.kind).toBe('ask');
    expect(classAttendance.apply).toBeUndefined();
    expect(quietMembers.apply).toBeUndefined();
    expect(classAttendance.capability).toBe('can_view_attendance');
    expect(quietMembers.capability).toBe('can_view_attendance');
  });

  it('default to a sensible period rather than refusing', () => {
    expect(classAttendance.sanitise({})).toEqual({ days: 7, weekday: null });
    expect(quietMembers.sanitise({})).toEqual({ weeks: 4 });
  });

  it('clamp a period nobody meant', () => {
    expect(classAttendance.sanitise({ days: 100000 })).toEqual({
      days: 7,
      weekday: null,
    });
    expect(quietMembers.sanitise({ weeks: -3 })).toEqual({ weeks: 4 });
  });

  it('take the day of the week when one was named', () => {
    expect(classAttendance.sanitise({ days: 28, weekday: 'Saturday' })).toEqual({
      days: 28,
      weekday: 'Saturday',
    });
  });
});

// Every date the parser emits comes from one line of its prompt, so that
// line has to be the gym's day and not UTC's. At 08:00 in Sydney UTC is
// still yesterday: told "today is the 4th", a model asked to cancel
// tomorrow's 6am class resolves it to the 5th, which is today at the gym.
// The wrong class gets cancelled and everybody booked on it is emailed
// about it.
describe('the parser is told the gym’s day', () => {
  const fn = readFileSync('supabase/functions/parse-setup/index.ts', 'utf8');

  it('never asks UTC what day it is', () => {
    // The one permitted use is the fallback inside todayAtGym, for a zone
    // Intl cannot read.
    const uses = fn.match(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(fn).toMatch(/catch \{\s*return new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/);
  });

  it('reads the zone off the gym rather than taking it from the caller', () => {
    expect(fn).toMatch(/from\('gyms'\)[\s\S]{0,80}select\('timezone'\)/);
    expect(fn).not.toMatch(/body\.timezone|body\.tz\b/);
  });

  it('tells the model which zone the day is in', () => {
    expect(fn).toMatch(/at the gym, whose timezone is \$\{tz\}/);
  });
});

// The shortlist is only safe because a refusal is re-asked against the
// whole catalogue before it reaches the owner. Grepped because dropping
// that retry would turn "the bar can't find the verb" into "Temple can't
// do that", silently, on a fraction of sentences nobody could predict.
describe('a shortlisted refusal is asked again', () => {
  const screen = readFileSync('src/app/(staff)/timeline.tsx', 'utf8');

  it('sends the shortlist first', () => {
    expect(screen).toMatch(/ask\(shortlist\(text, vocabulary, SHORTLIST, keep\)\)/);
  });

  it('re-asks with everything when the shortlist produced nothing', () => {
    expect(screen).toMatch(
      /if \(steps\.length === 0 && vocabulary\.length > SHORTLIST\) \{\s*p = await ask\(vocabulary\);/,
    );
  });

  it('carries the last card’s action through regardless of the words', () => {
    expect(screen).toMatch(/lastSpoken.*kind === 'action'/s);
  });
});

// An `ask` action can name a screen that shows more — attendance behind
// "how busy have we been", the campaign report behind "how did the
// Christmas email do". It says so by calling ctx.offer, and for a long
// while nothing happened: the Timeline ran spec.preview(args, actionCtx())
// with no collector, so the optional call was a no-op and three shipped
// chips never rendered once. Nothing failed and nothing looked wrong,
// which is exactly why it survived.
//
// So: every preview call has to be handed a collector, and an action that
// offers has to have somewhere for the offer to land.
describe('an offer made from a preview reaches the owner', () => {
  const screen = readFileSync('src/app/(staff)/timeline.tsx', 'utf8');

  it('never runs a preview without collecting what it offered', () => {
    const bare = screen.match(/\.preview\(\s*\w+\s*,\s*actionCtx\(\)\s*\)/g) ?? [];
    expect(bare).toEqual([]);
  });

  it('collects into the action message and renders it', () => {
    expect(screen).toMatch(/kind: 'action',\s+spec,\s+args,\s+preview,\s+offer,/);
    expect(screen).toMatch(/offer: first\.offer,/);
    expect(screen).toMatch(/<OfferChip offer=\{msg\.offer\} \/>/);
  });

  // The rule the chip exists to honour: the action names the way through,
  // the owner decides whether to take it. Nothing in the registry may
  // navigate for them.
  it('offers the way through rather than taking it', () => {
    const dir = 'src/lib/actions';
    const offenders = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => /\brouter\./.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('has an action that actually offers, or the wiring is theory', () => {
    const offering = ACTIONS.filter((a) =>
      /ctx\.offer\?\.\(/.test(a.preview.toString()),
    );
    expect(offering.length).toBeGreaterThan(0);
  });
});
