// The parser eval's fixture set: sentences an owner would actually say,
// each with the action the bar must map it to — or the explicit
// expectation that the bar refuses. 66 actions and, until this file,
// zero coverage of the English → action mapping, which is the
// highest-variance part of the product.
//
// The refusals are the half that matters most. "Cancel Marcus's
// membership" must NOT be rounded to the nearest menu item (money.refund,
// members.assign_plan) — writing somebody off stays human, and a parser
// that helpfully approximates a request like that is worse than one that
// says no.
//
// Args are asserted only where the argument IS the point. Over-pinning
// every arg makes the eval fail on phrasing the product would accept.

export type ExpectCase = {
  say: string;
  expect: { action: string; args?: Record<string, unknown> }[];
  note?: string;
};

export type CannotCase = { say: string; cannot: true; note?: string };

export type EvalCase = ExpectCase | CannotCase;

export function isCannot(c: EvalCase): c is CannotCase {
  return 'cannot' in c;
}

export const CASES: EvalCase[] = [
  // --- classes -------------------------------------------------------------
  { say: 'Who came to the 6am class this morning?', expect: [{ action: 'classes.attendance' }] },
  { say: 'Which classes have no coach next week?', expect: [{ action: 'classes.uncovered' }] },
  { say: "Book Priya into tomorrow's 6pm CrossFit", expect: [{ action: 'classes.book_member' }] },
  { say: 'Take Marcus out of Saturday gymnastics', expect: [{ action: 'classes.remove_member' }] },
  { say: "Cancel tonight's Olympic lifting class", expect: [{ action: 'classes.cancel' }] },
  { say: "Move Thursday's 7:15 Engine to 8am", expect: [{ action: 'classes.move' }] },
  { say: 'Set the 6am CrossFit capacity to 16', expect: [{ action: 'classes.edit' }] },
  { say: "Put Dan on Wednesday's 5:30 class", expect: [{ action: 'classes.set_coach' }] },
  { say: 'Find cover for Friday 5:30', expect: [{ action: 'classes.request_cover' }] },
  { say: 'Rename the Engine class to Conditioning', expect: [{ action: 'classes.rename_type' }] },
  { say: "Retire the Gymnastics class, we're not running it any more", expect: [{ action: 'classes.retire_type' }] },
  { say: 'Bring the Gymnastics class back', expect: [{ action: 'classes.restore_type' }] },

  // --- gym -----------------------------------------------------------------
  {
    say: 'Members can cancel up to 2 hours before class without losing a credit',
    expect: [{ action: 'gym.change_rules' }],
  },
  { say: 'Add a Tuesday and Thursday 6am HIIT class, 45 minutes, capacity 14', expect: [{ action: 'gym.add_classes' }] },
  { say: 'Close the gym from 24 to 26 December', expect: [{ action: 'gym.close_dates' }] },
  { say: 'Reopen on the 27th after all', expect: [{ action: 'gym.reopen' }] },
  { say: 'Rename the gym to Ironworks East', expect: [{ action: 'gym.rename' }] },

  // --- programming ---------------------------------------------------------
  { say: 'Block out a deload week starting Monday', expect: [{ action: 'programming.block_out' }] },
  { say: "Clear Thursday's programming", expect: [{ action: 'programming.clear_day' }] },
  { say: "Copy this week's programming into next week", expect: [{ action: 'programming.copy_week' }] },
  { say: 'Who is programmed for next week?', expect: [{ action: 'programming.who_is_programmed' }] },

  // --- comms ---------------------------------------------------------------
  { say: 'Draft a newsletter about the new opening hours', expect: [{ action: 'comms.draft_newsletter' }] },
  { say: 'Stop the send that is going out right now', expect: [{ action: 'comms.stop_send' }] },
  { say: 'How did the last campaign do?', expect: [{ action: 'comms.send_report' }] },

  // --- members -------------------------------------------------------------
  { say: 'Find Alex Chen', expect: [{ action: 'members.find' }] },
  { say: 'Put Alex Chen on the Unlimited plan', expect: [{ action: 'members.assign_plan' }] },
  { say: 'Comp Sarah two classes for the mix-up', expect: [{ action: 'members.comp' }] },
  { say: 'Tag Jordan Lee as a VIP', expect: [{ action: 'members.tag' }] },
  { say: 'Message Casey to say her membership is sorted', expect: [{ action: 'members.message' }] },
  { say: 'Who has gone quiet lately?', expect: [{ action: 'members.quiet' }] },

  // --- leads ---------------------------------------------------------------
  {
    say: 'Add a lead: Jamie, 07700 900123, walked in this morning asking about memberships',
    expect: [{ action: 'leads.add' }],
  },
  { say: 'Mark the lead Jamie as won', expect: [{ action: 'leads.set_status' }] },
  { say: "What's in the pipeline right now?", expect: [{ action: 'leads.pipeline' }] },

  // --- store ---------------------------------------------------------------
  { say: 'Add protein bars to the shop at 3 pounds', expect: [{ action: 'store.add_product' }] },
  { say: 'How are shop sales looking this month?', expect: [{ action: 'store.sales' }] },

  // --- team ----------------------------------------------------------------
  { say: 'Invite dan@example.com to coach here', expect: [{ action: 'team.invite' }] },
  { say: 'Make Dan an admin', expect: [{ action: 'team.set_role' }] },
  { say: 'Who is on the team?', expect: [{ action: 'team.who' }] },

  // --- money ---------------------------------------------------------------
  { say: 'How is revenue this month?', expect: [{ action: 'money.summary' }] },
  { say: 'Put the Unlimited plan up to 95 a month', expect: [{ action: 'money.set_plan_price' }] },
  { say: "Refund Marcus's last payment, we double-charged him", expect: [{ action: 'money.refund' }] },

  // --- plans / tags / system ----------------------------------------------
  { say: 'Retire the 10-pack, nobody buys it', expect: [{ action: 'plans.retire' }] },
  {
    say: 'Tag anyone who has not been in for a month as at-risk',
    expect: [{ action: 'tags.add_rule' }],
  },
  { say: 'Where do I set the cancellation window?', expect: [{ action: 'system.find_screen' }] },
  { say: 'Which screens does nobody open any more?', expect: [{ action: 'usage.what_nobody_opens' }] },

  // --- a chain -------------------------------------------------------------
  {
    say: 'Cancel tonight\'s 6pm class and message everyone booked to apologise',
    expect: [{ action: 'classes.cancel' }, { action: 'members.message' }],
    note: 'two steps from one sentence, in the order said',
  },

  // --- the refusals --------------------------------------------------------
  {
    say: "Cancel Marcus's membership",
    cannot: true,
    note: 'THE trap: must not round to money.refund or members.assign_plan — writing somebody off stays human',
  },
  {
    say: 'Members can cancel free on Mondays but pay a fee the rest of the week',
    cannot: true,
    note: 'a rule that varies by day has no field; must land in cannot, not the nearest rule',
  },
  {
    say: 'Give everyone 50% off in January',
    cannot: true,
    note: 'no bulk discount verb exists, and inventing one is the failure mode',
  },
  {
    say: "Delete Sarah's account and all her data",
    cannot: true,
    note: 'erasure is a legal workflow, not a bar verb',
  },
  {
    say: 'Text every gym in town about our open day',
    cannot: true,
    note: 'not our audience; must not become members.message or a newsletter',
  },
];

export type ParsedStep = { action: string; args: Record<string, unknown> };

export type Score = { pass: boolean; detail: string };

// Subset-match on args: only the keys the case pins are compared, by
// JSON value, so phrasing-dependent extras never fail a case.
export function scoreCase(
  c: EvalCase,
  steps: ParsedStep[],
  cannot: string | null,
): Score {
  if (isCannot(c)) {
    if (steps.length === 0 && !!cannot?.trim()) return { pass: true, detail: 'refused' };
    if (steps.length > 0) {
      return {
        pass: false,
        detail: `expected a refusal, got ${steps.map((s) => s.action).join(' + ')}`,
      };
    }
    return { pass: false, detail: 'expected a refusal, got an empty non-answer' };
  }
  const got = steps.map((s) => s.action).join(' + ') || '(nothing)';
  if (steps.length !== c.expect.length) {
    return {
      pass: false,
      detail: `expected ${c.expect.map((e) => e.action).join(' + ')}, got ${got}`,
    };
  }
  for (let i = 0; i < c.expect.length; i += 1) {
    const want = c.expect[i];
    if (steps[i].action !== want.action) {
      return {
        pass: false,
        detail: `step ${i + 1}: expected ${want.action}, got ${steps[i].action}`,
      };
    }
    for (const [k, v] of Object.entries(want.args ?? {})) {
      if (JSON.stringify(steps[i].args[k]) !== JSON.stringify(v)) {
        return {
          pass: false,
          detail: `step ${i + 1} (${want.action}): arg ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(steps[i].args[k])}`,
        };
      }
    }
  }
  return { pass: true, detail: got };
}
