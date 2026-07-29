// The action registry.
//
// The talk bar started as a handful of hand-built verbs: a field on the
// tool schema, a sanitiser, a resolver, a card and an apply path, each
// written out per verb. That reaches five things. It does not reach a
// platform, and "run my gym by saying what I want" is a promise about
// everything, not about five things.
//
// So an action declares itself once — what an owner would say, what
// arguments it takes, which capability it needs, how to preview it and
// how to run it — and everything else is derived. The parser's vocabulary
// is generated from the registry at call time, filtered to what this
// person is actually allowed to do, so the model is never even told about
// an action it couldn't perform. The client dispatches on the name and
// re-validates every argument itself, because model output stays
// untrusted no matter how the vocabulary was built.
//
// Adding an action to the bar is adding one entry here.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';

export type ActionArg = {
  name: string;
  // `money` takes the owner's units (pounds) and is stored in pence, so a
  // spec never has to remember which side of the boundary it is on.
  type: 'string' | 'integer' | 'money' | 'boolean' | 'enum' | 'date';
  desc: string;
  required?: boolean;
  values?: string[];
  min?: number;
  max?: number;
};

export type ActionContext = {
  supabase: SupabaseClient<Database>;
  gymId: string;
  userId: string;
};

// What the card shows. `lines` is the evidence; a `do` action gets the
// two-choice confirm underneath, an `ask` action is the answer itself.
export type ActionPreview = {
  title: string;
  lines: string[];
};

export type ActionSpec<A = Record<string, unknown>> = {
  name: string;
  kind: 'do' | 'ask';
  capability: string | null;
  // One line telling the model when this action is the right one. Written
  // as the owner would say it, because that is what it has to match.
  says: string;
  args: ActionArg[];
  // Model output re-checked against the spec's own rules. Null means the
  // request did not survive, and the bar says so rather than guessing.
  sanitise: (raw: Record<string, unknown>) => A | null;
  preview: (args: A, ctx: ActionContext) => Promise<ActionPreview>;
  // `do` actions only. Returns the receipt line.
  apply?: (args: A, ctx: ActionContext) => Promise<string>;
};

// The slice sent to the parser: enough to choose and fill an action,
// nothing about how it runs.
export type ActionWire = {
  name: string;
  kind: 'do' | 'ask';
  says: string;
  args: ActionArg[];
};

// A spec is written against its own argument type and stored in a list
// that can't know them all, so the registry holds the type-erased form.
// The one cast lives here rather than at every call site, and the pairing
// it hides — sanitise's output feeding preview and apply — is enforced at
// each spec's definition, which is where it can actually be checked.
export type AnyAction = Omit<ActionSpec, 'sanitise' | 'preview' | 'apply'> & {
  sanitise: (raw: Record<string, unknown>) => unknown | null;
  preview: (args: never, ctx: ActionContext) => Promise<ActionPreview>;
  apply?: (args: never, ctx: ActionContext) => Promise<string>;
};

export function erase<A>(spec: ActionSpec<A>): AnyAction {
  return spec as unknown as AnyAction;
}

export function toWire(spec: AnyAction): ActionWire {
  return { name: spec.name, kind: spec.kind, says: spec.says, args: spec.args };
}

// Shared argument readers. Every action validates through these rather
// than trusting the shape the model sent.
export function argString(
  raw: Record<string, unknown>,
  name: string,
  max = 120,
): string | null {
  const v = raw[name];
  if (typeof v !== 'string') return null;
  const clean = v.trim().replace(/\s+/g, ' ');
  return clean.length > 0 ? clean.slice(0, max) : null;
}

export function argInt(
  raw: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
): number | null {
  const v = raw[name];
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

// Pounds in, pence out. Accepts 1, "1", "1.50" and "£1.50" because all
// four are things people type; refuses a third decimal place rather than
// silently rounding someone's price.
export function argMoney(
  raw: Record<string, unknown>,
  name: string,
  maxPence = 10_000_00,
): number | null {
  const v = raw[name];
  let pounds: number;
  if (typeof v === 'number') pounds = v;
  else if (typeof v === 'string') {
    const clean = v.replace(/[£$€,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    pounds = Number(clean);
  } else return null;
  if (!Number.isFinite(pounds) || pounds < 0) return null;
  const pence = Math.round(pounds * 100);
  if (Math.abs(pounds * 100 - pence) > 0.001) return null;
  return pence <= maxPence ? pence : null;
}

export function argEnum<T extends string>(
  raw: Record<string, unknown>,
  name: string,
  values: readonly T[],
): T | null {
  const v = raw[name];
  return typeof v === 'string' && (values as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

export function argBool(
  raw: Record<string, unknown>,
  name: string,
): boolean | null {
  const v = raw[name];
  return typeof v === 'boolean' ? v : null;
}
