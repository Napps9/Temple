import { CLASS_ACTIONS } from './classes';
import { COMMS_ACTIONS } from './comms';
import { GYM_ACTIONS } from './gym';
import { MEMBER_ACTIONS } from './members';
import { MONEY_ACTIONS } from './money';
import { STORE_ACTIONS } from './store';
import { toWire, type AnyAction, type ActionWire } from './types';

export * from './types';
export type { MemberCard } from './members';

// Every action the bar can reach. Modules land here one at a time; the
// bar's vocabulary is whatever this list says it is.
export const ACTIONS: AnyAction[] = [
  ...GYM_ACTIONS,
  ...CLASS_ACTIONS,
  ...COMMS_ACTIONS,
  ...MEMBER_ACTIONS,
  ...MONEY_ACTIONS,
  ...STORE_ACTIONS,
];

export function findAction(name: unknown): AnyAction | null {
  if (typeof name !== 'string') return null;
  return ACTIONS.find((a) => a.name === name) ?? null;
}

// The vocabulary offered to the parser for one particular person: only
// what their capabilities allow, so the model cannot propose an action
// they would then be refused. `can` mirrors useCan — undefined means the
// capability set hasn't loaded, which is not permission.
export function actionsFor(
  can: (capability: string) => boolean | undefined,
): ActionWire[] {
  return ACTIONS.filter(
    (a) => a.capability === null || can(a.capability) === true,
  ).map((a) => toWire(a));
}
