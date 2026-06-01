import { Redirect, Stack } from 'expo-router';

import { isStaffRole, useGymMembership, useSession } from '@/lib/auth';

export default function StaffLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session === null) return <Redirect href="/(auth)/sign-in" />;
  if (!isLoading && membership && !isStaffRole(membership.role)) {
    return <Redirect href="/(member)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0B1220' },
        headerTintColor: '#F5F1E8',
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#0B1220' },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="team" options={{ title: 'Team' }} />
    </Stack>
  );
}
