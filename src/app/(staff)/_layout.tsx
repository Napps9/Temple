import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { isStaffRole, useGymMembership, useSession } from '@/lib/auth';

const STAFF_SECTIONS: NavSection[] = [
  { name: 'programming', href: '/programming', label: 'Programming' },
  { name: 'classes', href: '/classes', label: 'Classes' },
  { name: 'management', href: '/management', label: 'Manage' },
];

export default function StaffLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  if (session === null) return <Redirect href="/sign-in" />;
  if (!isLoading && membership && !isStaffRole(membership.role)) {
    return <Redirect href="/book" />;
  }

  return (
    <View className="flex-1 bg-gray-50">
      <TopNav sections={STAFF_SECTIONS} variant="staff" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: '#F9FAFB' },
          animation: 'none',
        }}>
        <Tabs.Screen name="classes" options={{ title: 'Classes' }} />
        <Tabs.Screen name="management" options={{ title: 'Management' }} />
        <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
      </Tabs>
    </View>
  );
}
