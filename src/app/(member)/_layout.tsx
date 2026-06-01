import { Redirect, Tabs } from 'expo-router';

import { StaffViewLinkIfStaff } from '@/components/CrossExperienceLink';
import { useSession } from '@/lib/auth';

export default function MemberLayout() {
  const session = useSession();
  if (session === null) return <Redirect href="/(auth)/sign-in" />;

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
        headerLeft: () => <StaffViewLinkIfStaff />,
      }}>
      <Tabs.Screen name="book" options={{ title: 'Book' }} />
      <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
      <Tabs.Screen name="workouts" options={{ title: 'Workouts' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
