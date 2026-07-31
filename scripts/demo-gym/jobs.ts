// The gym's jobs, for the demo gym.
//
// Without these the demo Timeline is only the gym's own activity — people
// joining, classes filling, a campaign going out — and the thing the
// product is actually for never appears. Six jobs ship (0206, 0208, 0234,
// 0235, 0241) and none of them can propose anything without an
// `agent_authority` row, so a demo gym with no authority rows shows zero
// proposals no matter what else is in it.
//
// What gets seeded is a morning: a few live questions at the top and a
// week of receipts under them. Both halves matter. The questions alone
// read as a to-do list, which is the thing the Timeline replaces; the
// receipts alone read as a log nobody can act on.
//
// Nothing here runs a tick. The ticks are cron-only and their predicates
// read live attendance and balances, so a seeded gym would produce
// whatever today's dates happened to make true. These rows are written
// directly, in the shape a tick writes them, so the demo says the same
// thing on any day.

type Json = Record<string, unknown>;

export type JobPerson = { id: string; name: string };

export type JobsCast = {
  // Retries exhausted — the money loop's founding case.
  urgentDunning: JobPerson;
  // One failure, Stripe still trying.
  softDunning: JobPerson;
  // On a pack, training hard enough that a membership is cheaper.
  packHeavy: JobPerson;
  // On a pack, nearly out, training normally.
  packLow: JobPerson;
  // Was a regular, has not been in for weeks.
  quiet: JobPerson;
  // Joined and has not trained yet.
  justJoined: JobPerson;
  // Whose class went uncovered.
  coverCoach: string;
};

export type JobsPrices = {
  unlimitedCents: number;
  creditPeriodCents: number;
  packCents: number;
  packCredits: number;
  unlimitedName: string;
  creditPeriodName: string;
  packName: string;
};

export type JobsInput = {
  gymId: string;
  ownerId: string;
  now: Date;
  currency: string;
  cast: JobsCast;
  prices: JobsPrices;
};

export type AgentAuthorityRow = {
  gym_id: string;
  action_kind: string;
  level: 'autonomous' | 'approval' | 'reserved';
  updated_by: string;
};

export type AgentTemplateRow = {
  gym_id: string;
  kind: string;
  body: string;
  approved_by: string;
};

export type AgentActionRow = {
  gym_id: string;
  teammate: 'revenue' | 'retention' | 'ops';
  action_kind: string;
  subject_profile: string | null;
  payload: Json;
  evidence: string[];
  status: 'proposed' | 'rejected' | 'executed';
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  executed_at: string | null;
};

// Mirrors public.money_text / _money_amount rather than using Intl, which
// resolves against the runtime's locale — the seeder's output has to be
// byte-identical for a given seed, and these strings also have to match
// what a real tick would have written into the same payload.
export function demoMoney(cents: number, currency: string): string {
  const amount =
    cents % 100 === 0 ? String(Math.trunc(cents / 100)) : (cents / 100).toFixed(2);
  const symbol: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    AUD: 'A$',
    CAD: 'C$',
    NZD: 'NZ$',
  };
  const s = symbol[currency.toUpperCase()];
  return s ? `${s}${amount}` : `${amount} ${currency.toUpperCase()}`;
}

function at(now: Date, days: number, hour: number, minute: number): string {
  const d = new Date(now.getTime() + days * 86_400_000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// The six take-on templates, matching the bodies each set_*_job RPC seeds.
// Present so that approving a live proposal in a demo actually queues a
// message rather than raising "No approved template".
const TEMPLATES: { kind: string; body: string }[] = [
  {
    kind: 'chase_message',
    body:
      "Hi {first_name} — it's {gym_name}. Your last payment didn't go " +
      'through. No panic, it happens — you can sort it here and nothing ' +
      'changes in the meantime.',
  },
  {
    kind: 'plan_adjustment_offer',
    body:
      "Hi {first_name} — it's {gym_name}. Your payment hasn't gone through " +
      'and we would rather keep you than lose you, so we can move you to ' +
      '{offer_plan} at {offer_price} a month instead — no hard feelings ' +
      'either way.',
  },
  {
    kind: 'retention_message',
    body:
      "Hi {first_name} — it's {gym_name}. We've not seen you in a while and " +
      'wanted to check in. Nothing needed from you — just say the word if ' +
      'you fancy getting back in.',
  },
  {
    kind: 'first_week_message',
    body:
      "Hi {first_name} — it's {gym_name}. You joined recently and we " +
      "haven't seen you in yet. The first one is the hard one, so tell us " +
      'when suits and we will get you booked in.',
  },
  {
    kind: 'credits_low_message',
    body:
      "Hi {first_name} — it's {gym_name}. Quick heads up: you've got " +
      '{credits_left} left on your {plan_name}. Top up whenever suits and ' +
      "you won't get caught short mid-week. If something else would suit " +
      "you better, just reply and we'll sort it.",
  },
  {
    kind: 'plan_upgrade_offer',
    body:
      "Hi {first_name} — it's {gym_name}. You've got {credits_left} left on " +
      "your {plan_name}. Looking at how often you've been in lately, " +
      '{offer_plan} at {offer_price} a month would work out cheaper than ' +
      'buying another pack — around {upgrade_saving} a month better off. ' +
      'Want us to switch you over? No rush either way, and the classes ' +
      "you've already paid for still stand.",
  },
];

export function buildAgentJobs(input: JobsInput): {
  authority: AgentAuthorityRow[];
  templates: AgentTemplateRow[];
  actions: AgentActionRow[];
} {
  const { gymId, ownerId, now, currency, cast, prices } = input;
  const money = (c: number) => demoMoney(c, currency);

  // The front desk runs itself; everything that writes to a member asks
  // first. That is the shipped default of every set_*_job RPC, and a demo
  // that quietly turned them all autonomous would be showing a product
  // nobody has agreed to.
  const authority: AgentAuthorityRow[] = [
    'chase_message',
    'plan_adjustment_offer',
    'retention_message',
    'cover_ask',
    'first_week_message',
    'credits_low_message',
    'plan_upgrade_offer',
  ].map((action_kind) => ({
    gym_id: gymId,
    action_kind,
    level: 'approval' as const,
    updated_by: ownerId,
  }));

  const templates: AgentTemplateRow[] = TEMPLATES.map((t) => ({
    gym_id: gymId,
    kind: t.kind,
    body: t.body,
    approved_by: ownerId,
  }));

  // The upgrade sum, computed rather than written down, so it stays true
  // if the demo catalogue's prices move.
  const perClass = Math.trunc(prices.packCents / prices.packCredits);
  const attended = 14;
  const atRate = attended * perClass;
  const saving = atRate - prices.unlimitedCents;

  const live: AgentActionRow[] = [
    {
      gym_id: gymId,
      teammate: 'revenue',
      action_kind: 'chase_message',
      subject_profile: cast.urgentDunning.id,
      payload: { member_name: cast.urgentDunning.name },
      evidence: [
        'Card declined 9 days ago — insufficient funds.',
        'Three attempts, and Stripe has stopped trying.',
        'Still training: in twice last week.',
      ],
      status: 'proposed',
      proposed_at: at(now, 0, 6, 5),
      decided_by: null,
      decided_at: null,
      executed_at: null,
    },
    {
      gym_id: gymId,
      teammate: 'revenue',
      action_kind: 'plan_upgrade_offer',
      subject_profile: cast.packHeavy.id,
      payload: {
        member_name: cast.packHeavy.name,
        plan_name: prices.packName,
        credits_left: 2,
        credits_left_phrase: '2 classes',
        attended_30d: attended,
        offer_plan_name: prices.unlimitedName,
        offer_price: money(prices.unlimitedCents),
        upgrade_saving: money(saving),
      },
      evidence: [
        `Trained ${attended} times in the last 30 days, with 2 classes left.`,
        `At ${money(perClass)} a class on their ${prices.packName}, another month at that rate is ${money(atRate)}.`,
        `${prices.unlimitedName} is ${money(prices.unlimitedCents)} — ${money(saving)} better off.`,
      ],
      status: 'proposed',
      proposed_at: at(now, 0, 9, 40),
      decided_by: null,
      decided_at: null,
      executed_at: null,
    },
    {
      gym_id: gymId,
      teammate: 'retention',
      action_kind: 'retention_message',
      subject_profile: cast.quiet.id,
      payload: { member_name: cast.quiet.name, weeks_absent: 4 },
      evidence: [
        'Last trained 29 days ago.',
        'Was in twice a week before that, for eight months.',
        'Still paying — the plan renews in 11 days.',
      ],
      status: 'proposed',
      proposed_at: at(now, 0, 8, 45),
      decided_by: null,
      decided_at: null,
      executed_at: null,
    },
  ];

  // A week behind it. Mixed outcomes on purpose: a demo where the owner
  // said yes to everything does not show that no is a real answer, and
  // "you said leave it, so I did" is the line that makes the rope
  // believable.
  const history: AgentActionRow[] = [
    {
      gym_id: gymId,
      teammate: 'revenue',
      action_kind: 'credits_low_message',
      subject_profile: cast.packLow.id,
      payload: {
        member_name: cast.packLow.name,
        plan_name: prices.packName,
        credits_left: 1,
        credits_left_phrase: '1 class',
      },
      evidence: [
        `1 class left on their ${prices.packName}.`,
        'Last trained 3 days ago.',
        'Still booking, so this is a top-up rather than a goodbye.',
      ],
      status: 'executed',
      proposed_at: at(now, -1, 9, 45),
      decided_by: ownerId,
      decided_at: at(now, -1, 10, 2),
      executed_at: at(now, -1, 10, 2),
    },
    {
      gym_id: gymId,
      teammate: 'ops',
      action_kind: 'cover_ask',
      subject_profile: null,
      payload: { requester_name: cast.coverCoach },
      evidence: [
        'Asked 2 days ago and still unclaimed.',
        'Four coaches can take it.',
        'The class is tomorrow morning.',
      ],
      status: 'executed',
      proposed_at: at(now, -2, 7, 20),
      decided_by: ownerId,
      decided_at: at(now, -2, 7, 41),
      executed_at: at(now, -2, 7, 41),
    },
    {
      gym_id: gymId,
      teammate: 'retention',
      action_kind: 'first_week_message',
      subject_profile: cast.justJoined.id,
      payload: { member_name: cast.justJoined.name, days_since_join: 12 },
      evidence: [
        'Joined 12 days ago.',
        'Has not booked anything yet.',
        'Paying for an active membership.',
      ],
      status: 'executed',
      proposed_at: at(now, -3, 9, 15),
      decided_by: ownerId,
      decided_at: at(now, -3, 9, 26),
      executed_at: at(now, -3, 9, 26),
    },
    {
      gym_id: gymId,
      teammate: 'revenue',
      action_kind: 'chase_message',
      subject_profile: cast.softDunning.id,
      payload: { member_name: cast.softDunning.name },
      evidence: [
        'Card declined 2 days ago.',
        'First failure — Stripe tries again in 3 days.',
        'In on Monday and Wednesday.',
      ],
      status: 'executed',
      proposed_at: at(now, -4, 6, 5),
      decided_by: ownerId,
      decided_at: at(now, -4, 6, 33),
      executed_at: at(now, -4, 6, 33),
    },
    {
      gym_id: gymId,
      teammate: 'retention',
      action_kind: 'retention_message',
      subject_profile: cast.justJoined.id,
      payload: { member_name: cast.justJoined.name, weeks_absent: 3 },
      evidence: [
        'Last trained 22 days ago.',
        'Was coming once a week.',
        'Still on an active plan.',
      ],
      status: 'rejected',
      proposed_at: at(now, -5, 8, 45),
      decided_by: ownerId,
      decided_at: at(now, -5, 9, 12),
      executed_at: null,
    },
    {
      gym_id: gymId,
      teammate: 'revenue',
      action_kind: 'plan_adjustment_offer',
      subject_profile: cast.softDunning.id,
      payload: {
        member_name: cast.softDunning.name,
        offer_plan_name: prices.creditPeriodName,
        offer_price: money(prices.creditPeriodCents),
      },
      evidence: [
        'Two payments missed in three months.',
        `Averaging 6 classes a month — ${prices.creditPeriodName} covers that.`,
        `${money(prices.creditPeriodCents)} instead of ${money(prices.unlimitedCents)}.`,
      ],
      status: 'executed',
      proposed_at: at(now, -6, 6, 5),
      decided_by: ownerId,
      decided_at: at(now, -6, 8, 1),
      executed_at: at(now, -6, 8, 1),
    },
  ];

  return { authority, templates, actions: [...live, ...history] };
}

// Exposed for the seeder's summary line, so "3 waiting" is counted from
// the rows rather than asserted in a console.log.
export function countWaiting(actions: AgentActionRow[]): number {
  return actions.filter((a) => a.status === 'proposed').length;
}
