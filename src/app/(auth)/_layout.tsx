import { Redirect, Stack, usePathname } from 'expo-router';

import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export default function AuthLayout() {
  const pathname = usePathname();
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  // /reset-password establishes a real (recovery) session the moment the
  // emailed link is opened, so an existing member with a membership would
  // otherwise get redirected straight past the "choose a new password"
  // form by this same check before they ever see it.
  const isResettingPassword = pathname === '/reset-password';
  // Since 0283 an account can belong to more than one gym, so a member
  // opening another gym's join link, invite or trial pass has to reach
  // that screen; each of them already handles the signed-in case itself.
  const isTakingAnotherGym =
    pathname.startsWith('/join/') ||
    pathname === '/accept-invite' ||
    pathname.startsWith('/trial/');

  if (
    !isResettingPassword &&
    !isTakingAnotherGym &&
    session &&
    !isLoading &&
    membership &&
    canAccessStaff !== undefined
  ) {
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
