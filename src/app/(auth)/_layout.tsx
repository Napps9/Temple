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

  return <Stack screenOptions={{ headerShown: false }} />;
}
