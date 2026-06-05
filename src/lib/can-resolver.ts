import { can, type Capability } from './can';
import type { GymRole } from '@/types/database';

export type OverrideRow = {
  role: GymRole;
  capability: string;
  enabled: boolean;
};

export type CanState = {
  membershipLoading: boolean;
  role: GymRole | null;
  overridesLoading: boolean;
  overrides: OverrideRow[] | undefined;
};

// Pure capability resolver — the brain of useCan. Lives in its own
// module (free of React / react-native deps) so it can be unit-tested
// without a bundler that understands RN.
//
// Returns:
//   - undefined while membership or (for non-owner/non-member roles)
//     overrides are still loading. Callers that need to make a
//     binding decision (redirects) must check === false explicitly,
//     never treat undefined as a denial.
//   - true if the current user has the capability — owners always,
//     non-owner roles per override or per baked-in default matrix.
//   - false if explicitly denied — members for staff-area caps, or
//     overrides set to false, or the default matrix says no.
export function computeCan(
  capability: Capability,
  state: CanState,
): boolean | undefined {
  if (state.membershipLoading) return undefined;
  if (!state.role) return false;
  // Owner and member are structural floors / ceilings — never gated
  // on overrides. Owner returning true before we even look at the
  // overrides query is the critical path that lets an owner reach the
  // staff area even if gym_role_capabilities is empty / missing /
  // still loading.
  if (state.role === 'owner') return true;
  if (state.role === 'member') return false;
  if (state.overridesLoading) return undefined;
  const override = state.overrides?.find(
    (o) => o.role === state.role && o.capability === capability,
  );
  if (override) return override.enabled;
  return can(state.role, capability);
}
