import { Redirect, Stack, usePathname } from 'expo-router';

import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export default function AuthLayout() {
  const session = useSession();
  const pathname = usePathname();
  const { data: membership, isLoading, isError } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  if (session && !isLoading && membership && canAccessStaff !== undefined) {
    return <Redirect href={canAccessStaff ? '/classes' : '/book'} />;
  }

  // A signed-in user with no (or unreadable) membership used to be
  // stranded on /sign-in: the success handler doesn't navigate, and the
  // redirect above requires a membership. Bounce them to /welcome so
  // there's always a next step on screen. Scoped to /sign-in only —
  // /welcome, /create-gym, /join/* and /accept-invite are exactly the
  // routes a signed-in-but-gymless user needs to reach.
  if (session && pathname === '/sign-in' && (isError || (!isLoading && !membership))) {
    return <Redirect href="/welcome" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
