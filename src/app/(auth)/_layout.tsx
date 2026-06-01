import { Redirect, Stack } from 'expo-router';

import { useGymMembership, useSession } from '@/lib/auth';

export default function AuthLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session && !isLoading && membership) {
    return <Redirect href={membership.role === 'member' ? '/book' : '/classes'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
