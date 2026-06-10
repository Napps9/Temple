import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';

const STAFF_SECTIONS: NavSection[] = [
  { name: 'programming', href: '/programming', label: 'Programming', icon: 'barbell-outline' },
  { name: 'classes', href: '/classes', label: 'Classes', icon: 'calendar-outline' },
  { name: 'management', href: '/management', label: 'Manage', icon: 'settings-outline' },
];

export default function StaffLayout() {
  const session = useSession();
  const colors = useThemeColors();
  const canAccessStaff = useCan('can_access_staff_area');

  if (session === null) return <Redirect href="/sign-in" />;
  if (canAccessStaff === false) {
    return <Redirect href="/book" />;
  }

  return (
    <View className="flex-1 bg-slate-100 dark:bg-gray-950">
      <TopNav sections={STAFF_SECTIONS} variant="staff" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: colors.screenBg },
          animation: 'none',
        }}>
        <Tabs.Screen name="classes" options={{ title: 'Classes' }} />
        <Tabs.Screen name="management" options={{ title: 'Management' }} />
        <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
      </Tabs>
    </View>
  );
}
