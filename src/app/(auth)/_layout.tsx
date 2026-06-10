import { Redirect, Stack } from 'expo-router';

import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export default function AuthLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  if (session && !isLoading && membership && canAccessStaff !== undefined) {
    return <Redirect href={canAccessStaff ? '/classes' : '/book'} />;
  }

  // No catch-all redirect for session-without-membership here: a
  // <Redirect> rendered from a layout re-fires on every navigation
  // commit before usePathname catches up, which dispatched 50+ nested
  // navigations and crashed prod with React #185. The sign-in screen
  // navigates imperatively on success instead, and the root index
  // routes gymless users to /welcome.
  return <Stack screenOptions={{ headerShown: false }} />;
}
