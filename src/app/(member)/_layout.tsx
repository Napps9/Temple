import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/lib/auth';

export default function MemberLayout() {
  const session = useSession();
  if (session === null) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B1220' },
      }}
    />
  );
}
