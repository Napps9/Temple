import { Stack } from 'expo-router';

import { MemberViewLink } from '@/components/CrossExperienceLink';

export default function ManagementLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0B1220' },
        headerShadowVisible: false,
        headerTintColor: '#F5F1E8',
        headerTitleStyle: { color: '#F5F1E8', fontWeight: '600' },
        contentStyle: { backgroundColor: '#0B1220' },
        headerRight: () => <MemberViewLink />,
      }}>
      <Stack.Screen name="index" options={{ title: 'Management' }} />
      <Stack.Screen name="team" options={{ title: 'Team' }} />
    </Stack>
  );
}
