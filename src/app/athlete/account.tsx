import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useSession, useSignOut } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export default function AthleteAccount() {
  const session = useSession();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const athleteActive = useQuery({
    queryKey: ['athlete-active', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('is_athlete_active');
      if (error) throw error;
      return data as boolean;
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_athlete_subscription', {});
      if (error) throw error;
    },
    onSuccess: () => {
      setCancelError(null);
      queryClient.invalidateQueries({ queryKey: ['athlete-active'] });
    },
    onError: (e) => setCancelError(errorMessage(e, 'Could not cancel')),
  });

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-center gap-2">
          <BackLink inline label="Athlete" fallbackHref="/athlete" />
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Account
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-1">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Signed in as
          </Text>
          <Text className="text-gray-900 dark:text-gray-50">
            {session?.user.email ?? '—'}
          </Text>
        </View>

        {athleteActive.data ? (
          <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                Solo tracking
              </Text>
              <View className="rounded-full bg-emerald-500/15 px-2 py-0.5">
                <Text className="text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest">
                  Active · free in beta
                </Text>
              </View>
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              You can log workouts and PRs without a gym. Cancelling stops new
              logging — your history stays.
            </Text>
            <ChipButton
              tone="red"
              className="self-start"
              label="Cancel solo tracking"
              icon="close-circle-outline"
              onPress={() => cancel.mutate()}
              disabled={cancel.isPending}
            />
            {cancelError ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {cancelError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Train with a gym
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Join an existing gym with an invite link, or start your own. Your
            training history comes with you.
          </Text>
          <View className="flex-row gap-2">
            <Link href="/accept-invite" asChild>
              <Pressable className="flex-1 bg-primary active:bg-primary-dark rounded-xl px-4 py-3 items-center">
                <Text className="text-white font-semibold">Join a gym</Text>
              </Pressable>
            </Link>
            <Link href="/create-gym" asChild>
              <Pressable className="flex-1 rounded-xl px-4 py-3 items-center border border-gray-200 dark:border-gray-700 active:opacity-70">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                  Start a gym
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <Button
          variant="secondary"
          onPress={() => signOut.mutate()}
          loading={signOut.isPending}>
          Sign out
        </Button>
      </ScrollView>
    </Screen>
  );
}
