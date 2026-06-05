import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useGymMembership, useSession } from '@/lib/auth';
import { useCan } from '@/lib/useCan';

export default function AuthLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const canAccessStaff = useCan('can_access_staff_area');

  const willRedirect =
    !!session && !isLoading && !!membership && canAccessStaff !== undefined;
  const target = canAccessStaff ? '/classes' : '/book';

  // Diagnostic log for the "owner cannot reach staff" report. Fires
  // once per distinct decision (signature of the inputs), so it does
  // not spam during routine renders.
  const lastLogged = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${!!session}|${isLoading}|${membership?.role ?? 'null'}|${String(
      canAccessStaff,
    )}|${willRedirect}|${target}`;
    if (lastLogged.current === sig) return;
    lastLogged.current = sig;
    // eslint-disable-next-line no-console
    console.log('[temple-debug] (auth) gate', {
      hasSession: !!session,
      membershipLoading: isLoading,
      role: membership?.role ?? null,
      canAccessStaff,
      willRedirect,
      target: willRedirect ? target : null,
    });
  }, [session, isLoading, membership?.role, canAccessStaff, willRedirect, target]);

  if (willRedirect) {
    return <Redirect href={target} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
