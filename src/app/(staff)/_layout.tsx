import { Redirect, Tabs } from 'expo-router';

import { MemberViewLink } from '@/components/CrossExperienceLink';
import { isStaffRole, useGymMembership, useSession } from '@/lib/auth';

export default function StaffLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session === null) return <Redirect href="/sign-in" />;
  if (!isLoading && membership && !isStaffRole(membership.role)) {
    return <Redirect href="/book" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0B1220' },
        headerShadowVisible: false,
        headerTintColor: '#F5F1E8',
        headerTitleStyle: { color: '#F5F1E8', fontWeight: '600' },
        tabBarStyle: { backgroundColor: '#0B1220', borderTopColor: '#1A2230' },
        tabBarActiveTintColor: '#C5A572',
        tabBarInactiveTintColor: '#9CA3AF',
        sceneStyle: { backgroundColor: '#0B1220' },
        headerRight: () => <MemberViewLink />,
      }}>
      <Tabs.Screen name="classes" options={{ title: 'Classes' }} />
      <Tabs.Screen
        name="management"
        options={{ title: 'Management', headerShown: false }}
      />
      <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
    </Tabs>
  );
}
