import { BACK_OFFICE_ACTIONS } from './back-office';
import { CLASS_ACTIONS } from './classes';
import { COMMS_ACTIONS } from './comms';
import { GYM_ACTIONS } from './gym';
import { LEAD_ACTIONS } from './leads';
import { MEMBER_ACTIONS } from './members';
import { MONEY_ACTIONS } from './money';
import { PLAN_ACTIONS } from './plans';
import { PROGRAMMING_ACTIONS } from './programming';
import { STORE_ACTIONS } from './store';
import { TEAM_ACTIONS } from './team';
import { WEBSITE_ACTIONS } from './website';
import { toWire, type AnyAction, type ActionWire } from './types';

export * from './types';
export type { EmailDraftCard } from './comms';
export type { MemberCard } from './members';

// Every action the bar can reach. Modules land here one at a time; the
// bar's vocabulary is whatever this list says it is.
export const ACTIONS: AnyAction[] = [
  ...GYM_ACTIONS,
  ...LEAD_ACTIONS,
  ...CLASS_ACTIONS,
  ...COMMS_ACTIONS,
  ...MEMBER_ACTIONS,
  ...MONEY_ACTIONS,
  ...PLAN_ACTIONS,
  ...PROGRAMMING_ACTIONS,
  ...STORE_ACTIONS,
  ...TEAM_ACTIONS,
  ...WEBSITE_ACTIONS,
  ...BACK_OFFICE_ACTIONS,
];

export function findAction(name: unknown): AnyAction | null {
  if (typeof name !== 'string') return null;
  return ACTIONS.find((a) => a.name === name) ?? null;
}

// The vocabulary offered to the parser for one particular person: only
// what their capabilities allow, so the model cannot propose an action
// they would then be refused. `can` mirrors useCan — undefined means the
// capability set hasn't loaded, which is not permission.
//
// `role` is the second half of the same promise, and omitting it is not
// permission either: an action that names roles is withheld from a caller
// whose role we have not been told. A vocabulary that guesses wide is the
// failure this whole filter exists to prevent.
export function actionsFor(
  can: (capability: string) => boolean | undefined,
  role?: string | null,
): ActionWire[] {
  return ACTIONS.filter(
    (a) =>
      (a.capability === null || can(a.capability) === true) &&
      (a.roles === undefined || (!!role && a.roles.includes(role))),
  ).map((a) => toWire(a));
}
