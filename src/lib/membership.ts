import type { GymRole } from '@/types/database';

export type GymMembership = {
  gymId: string;
  gymName: string;
  role: GymRole;
};

// Pure parser for the gym_memberships row + embedded gyms(name).
// Lives in its own module (free of React / react-native deps) so it
// can be unit-tested without a bundler that understands RN.
//
// Defensive against:
//   - data null (no membership row) → returns null
//   - missing gym_id or role on the row → returns null. Treated as
//     "no usable membership" rather than throwing, which would put
//     the React Query into error state and trigger the retry loop
//     this whole refactor exists to prevent.
//   - gyms embed being an object (1:1 PostgREST shape), an array
//     (PostgREST sometimes returns to-one as a one-element array),
//     null (RLS hid the gym row), or empty array.
export type MembershipRowInput = {
  gym_id: string;
  role: GymRole;
  gyms: { name: string | null } | { name: string | null }[] | null;
};

export function parseMembershipRow(
  data: MembershipRowInput | null | undefined,
): GymMembership | null {
  if (!data) return null;
  if (typeof data.gym_id !== 'string' || !data.role) return null;
  let gymName = '';
  const gymsField = data.gyms;
  if (gymsField) {
    if (Array.isArray(gymsField)) {
      gymName = gymsField[0]?.name ?? '';
    } else {
      gymName = gymsField.name ?? '';
    }
  }
  return {
    gymId: data.gym_id,
    gymName,
    role: data.role,
  };
}
