import { Redirect, Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useGymMembership, useSession } from '@/lib/auth';
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
  const { data: membership } = useGymMembership();

  // Diagnostic log for the staff-area access gate. Fires once per
  // distinct (role, canAccessStaff) state, never on every render. The
  // intent is to make the production-console story unambiguous when
  // someone reports "owner cannot access staff": you can see the role
  // the client thinks it has and what useCan() decided about it.
  const lastLogged = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${membership?.role ?? 'null'}|${String(canAccessStaff)}`;
    if (lastLogged.current === sig) return;
    lastLogged.current = sig;
    // eslint-disable-next-line no-console
    console.log('[temple-debug] (staff) gate', {
      role: membership?.role ?? null,
      canAccessStaff,
    });
  }, [membership?.role, canAccessStaff]);

  if (session === null) return <Redirect href="/sign-in" />;
  if (canAccessStaff === false) {
    return <Redirect href="/book" />;
  }

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
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
