import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ProgrammingCalendar } from '@/components/ProgrammingCalendar';
import { useCan } from '@/lib/useCan';

// The one URL two screens share, and therefore the one page that has to
// decide who it is for.
//
// (member)/programming and (staff)/programming both serve at /programming —
// a directory in parentheses is a route group and contributes no segment —
// and the static export can write only one dist/programming.html for that
// URL. It wrote this one. Which of the two it picks is not something we
// choose, so the other screen simply has no cold-loadable URL: an owner who
// refreshed, bookmarked, or followed the marketing site's /programming demo
// link got the member's read-only calendar instead of the editor, with no
// rail to get back to, and nothing corrected it afterwards — the member
// layout redirects a signed-out visitor and nobody else.
//
// Client-side navigation never had the problem: both layouts pin their
// Programming pill to a group-qualified navigateTo. But a cold load has no
// group to read, so the signal has to travel in the URL. `as=member` is what
// the member nav sends, and it marks the crossing an owner makes on purpose
// — Viewing Staff, then the member dock, then Programming, which is Job 4 of
// the demo. It means "the member render, whoever is asking". Without it, the
// capability decides.
export default function MemberProgramming() {
  const { as, ...params } = useLocalSearchParams<{ as?: string }>();
  const canAccessStaff = useCan('can_access_staff_area');

  // showMyPercentages is set only here: this is the one surface where the
  // viewer and the athlete the programming is for are the same person, so
  // resolving "@ 75%" against the viewer's rep maxes is correct. The staff
  // surfaces share this component. Built as an element rather than returned
  // three times — creating it runs none of its hooks.
  const memberCalendar = <ProgrammingCalendar mode="view" showMyPercentages />;

  if (as === 'member') return memberCalendar;

  // undefined is "still loading", never a denial (can-resolver.ts). Falling
  // through it would flash the member calendar at an owner and fetch their
  // rep maxes to draw percentages against programming written for the whole
  // gym. An owner resolves true as soon as their membership does, and a
  // member false, so this window is short for both.
  if (canAccessStaff === undefined) {
    return (
      <View className="flex-1 bg-ground dark:bg-ground-dk items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  if (canAccessStaff) {
    // Carry the rest of the query across. ClassDetailModal opens the day a
    // class is programmed for with `?date=`, and a redirect that dropped it
    // would land the coach on today instead of the class they tapped.
    const rest = new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value] as [string, string]] : [],
      ),
    ).toString();
    return (
      <Redirect href={`/(staff)/programming${rest ? `?${rest}` : ''}` as never} />
    );
  }

  return memberCalendar;
}
