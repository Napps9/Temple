import { Redirect, Tabs, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { BottomDock } from '@/components/BottomDock';
import { SideNav, useRailCollapsed } from '@/components/SideNav';
import { TopNav, type NavSection } from '@/components/TopNav';
import { LG, MD } from '@/lib/breakpoint';
import { useGymMembership, useSession } from '@/lib/auth';
import { useDemoViews } from '@/lib/demo-visit';
import { shouldRecord } from '@/lib/route-usage';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';

const STAFF_SECTIONS: NavSection[] = [
  {
    name: 'timeline',
    href: '/timeline',
    label: 'Timeline',
    icon: 'newspaper-outline',
  },
  // Programming exists under both (staff) and (member) at the same
  // '/programming' URL — the group-qualified navigateTo pins this pill to
  // the staff editor specifically. See NavSection's comment.
  {
    name: 'programming',
    href: '/programming',
    navigateTo: '/(staff)/programming',
    label: 'Programming',
    icon: 'barbell-outline',
  },
  { name: 'classes', href: '/classes', label: 'Classes', icon: 'calendar-outline' },
  { name: 'management', href: '/management', label: 'Manage', icon: 'settings-outline' },
];

// Counting which screens get opened, so the burndown rests on evidence
// rather than on opinion (0233). A gym, a route, a day — no name.
//
// The hazard is documented three files away and is why this is a ref and
// not state: a layout that re-renders on every navigation commit is the
// exact shape that once dispatched fifty nested navigations here and
// crashed production with React #185 (see the note in
// src/app/(auth)/_layout.tsx). This renders nothing, redirects nothing,
// holds its last value outside React, and swallows every error — a
// counter must never be the reason a screen change fails.
function useRouteOpens(gymId: string | null | undefined) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!gymId) return;
    const route = shouldRecord(pathname, last.current);
    if (!route) return;
    last.current = route;
    void supabase.rpc('record_route_open', { p_gym_id: gymId, p_route: route });
  }, [pathname, gymId]);
}

export default function StaffLayout() {
  const session = useSession();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const canAccessStaff = useCan('can_access_staff_area');
  const { data: membership } = useGymMembership();
  const { isDemo } = useGymBrand();
  useRouteOpens(membership?.gymId);
  // Separate from useRouteOpens on purpose: that one counts staff screens
  // for every gym and can never name anybody, this one records a demo
  // visitor's path and never touches a real tenant (0279).
  useDemoViews(membership?.gymId, isDemo);

  if (session === null) return <Redirect href="/sign-in" />;
  if (canAccessStaff === false) {
    return <Redirect href="/book" />;
  }

  // A rail beside the pages at 1024 and up, a top bar below it. The
  // router is the same either way — this swaps the chrome, not the
  // navigation: four sections centred in a 1400px window left the top
  // third of the screen doing nothing and gave Members, Plans,
  // Communications and Billing nowhere to live except behind Manage.
  //
  // 1024 rather than 768 because the rail is 246px the page never sees;
  // see lib/breakpoint.ts.
  const rail = width >= LG;
  const [railCollapsed, toggleRailCollapsed] = useRailCollapsed();

  const tabs = (
    <>
      {/* backBehavior="history": when a back press bubbles past a tab's
          inner stack, return to the tab the user was actually on. The
          default is firstRoute, which sent Timeline -> member -> Back to
          Programming analysis purely because "analysis" is declared first
          below. */}
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: {
            backgroundColor: colors.screenBg,
          },
          animation: 'none',
        }}>
        <Tabs.Screen name="analysis" options={{ title: 'Analysis' }} />
        <Tabs.Screen name="classes" options={{ title: 'Classes' }} />
        <Tabs.Screen name="management" options={{ title: 'Management' }} />
        <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
        <Tabs.Screen name="setup" options={{ title: 'Setup' }} />
        <Tabs.Screen name="timeline" options={{ title: 'Timeline' }} />
      </Tabs>
    </>
  );

  if (rail) {
    return (
        <View className="flex-1 flex-row bg-ground dark:bg-ground-dk">
          <SideNav
            sections={STAFF_SECTIONS}
            collapsed={railCollapsed}
            onToggleCollapsed={toggleRailCollapsed}
          />
          <View className="flex-1 min-w-0">{tabs}</View>
        </View>
    );
  }

  return (
      <View className="flex-1 bg-ground dark:bg-ground-dk">
        <TopNav sections={STAFF_SECTIONS} variant="staff" />
        {tabs}
        <BottomDock sections={STAFF_SECTIONS} variant="staff" />
      </View>
  );
}
