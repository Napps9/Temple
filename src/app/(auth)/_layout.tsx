import { Redirect, Stack } from 'expo-router';

import { useGymMembership, useSession } from '@/lib/auth';
import { can } from '@/lib/can';

export default function AuthLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session && !isLoading && membership) {
    return <Redirect href={can(membership.role, 'can_access_staff_area') ? '/classes' : '/book'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
