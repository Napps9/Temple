// Audience predicate evaluator.
//
// Mirrors the future SQL-side evaluator that the dispatcher will use
// at send time. Keeping them aligned means the compose-an-audience
// UI can preview the matching member count using the same logic
// that actually decides who receives the message.
//
// Predicate shape (kept deliberately small — sprint 3 cut):
//   { clauses: Clause[] }                         // AND of clauses
//   Clause = { field, op, value }
//
//   field          op                value
//   plan_status    in                ['active', 'paused', ...]
//   plan_status    eq                'active'
//   tags           includes_any      ['intro', 'foundation']
//   tags           includes_all      ['founder']
//   has_ever_paid  eq                true | false
//   days_since_signup  lt | gt | eq  number
//   last_booked_at days_ago_lt       number      (booked within N days)
//   last_booked_at days_ago_gt       number      (haven't booked in N+ days)
//
// Operators that don't apply to a field type throw — better to fail
// loud than silently miss members.

export type MemberContext = {
  planStatus: string | null;
  tags: string[];
  hasEverPaid: boolean;
  daysSinceSignup: number;
  lastBookedAt: Date | null;
  now?: Date;
};

export type Clause =
  | { field: 'plan_status'; op: 'eq'; value: string }
  | { field: 'plan_status'; op: 'in'; value: string[] }
  | { field: 'tags'; op: 'includes_any' | 'includes_all'; value: string[] }
  | { field: 'has_ever_paid'; op: 'eq'; value: boolean }
  | { field: 'days_since_signup'; op: 'eq' | 'lt' | 'gt'; value: number }
  | { field: 'last_booked_at'; op: 'days_ago_lt' | 'days_ago_gt'; value: number };

export type Predicate = { clauses: Clause[] };

export function evaluateAudience(
  predicate: Predicate,
  ctx: MemberContext,
): boolean {
  return predicate.clauses.every((c) => evaluateClause(c, ctx));
}

function evaluateClause(c: Clause, ctx: MemberContext): boolean {
  switch (c.field) {
    case 'plan_status':
      if (ctx.planStatus === null) return false;
      if (c.op === 'eq') return ctx.planStatus === c.value;
      if (c.op === 'in') return c.value.includes(ctx.planStatus);
      break;
    case 'tags':
      if (c.op === 'includes_any') {
        return c.value.some((t) => ctx.tags.includes(t));
      }
      if (c.op === 'includes_all') {
        return c.value.every((t) => ctx.tags.includes(t));
      }
      break;
    case 'has_ever_paid':
      return ctx.hasEverPaid === c.value;
    case 'days_since_signup':
      if (c.op === 'eq') return ctx.daysSinceSignup === c.value;
      if (c.op === 'lt') return ctx.daysSinceSignup < c.value;
      if (c.op === 'gt') return ctx.daysSinceSignup > c.value;
      break;
    case 'last_booked_at': {
      if (!ctx.lastBookedAt) {
        // No bookings = "haven't booked in any number of days".
        return c.op === 'days_ago_gt';
      }
      const now = ctx.now ?? new Date();
      const daysAgo =
        (now.getTime() - ctx.lastBookedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (c.op === 'days_ago_lt') return daysAgo < c.value;
      if (c.op === 'days_ago_gt') return daysAgo > c.value;
      break;
    }
  }
  throw new Error(
    `Unsupported clause: field=${(c as Clause).field} op=${(c as Clause).op}`,
  );
}
