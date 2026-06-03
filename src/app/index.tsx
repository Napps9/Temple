import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { can } from '@/lib/can';
import { supabase } from '@/lib/supabase';

export default function Index() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();

  // Athletes: signed in, no gym membership, but holding a platform
  // subscription with Temple. Route them into the (athlete) group.
  const platformQuery = useQuery({
    queryKey: ['platform-sub', session?.user.id],
    enabled: !!session?.user.id && !isLoading && !membership,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('platform_subscriptions')
        .select('status')
        .eq('profile_id', session!.user.id)
        .maybeSingle();
      if (error) return false;
      return !!data && data.status !== 'cancelled';
    },
  });

  if (session === undefined) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (isLoading) return <Loading />;
  if (membership) {
    return (
      <Redirect
        href={can(membership.role, 'can_access_staff_area') ? '/classes' : '/book'}
      />
    );
  }
  if (platformQuery.isLoading) return <Loading />;
  if (platformQuery.data) return <Redirect href="/athlete/workouts" />;
  return <Redirect href="/sign-in" />;
}

function Loading() {
  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950 items-center justify-center">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
