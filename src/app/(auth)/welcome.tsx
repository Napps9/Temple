import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import {
  completePendingGym,
  completePendingJoin,
  pendingGymFromSession,
  pendingJoinFromSession,
  refreshMembership,
  useGymMembership,
  useSession,
  useSignOut,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

// Shown when a user is signed in but has no gym membership yet — either
// they just confirmed an email from the create-gym or join flow (and we
// finish the job, fully branded, in one tap), they joined via
// /join/[slug] but the binding failed, or they cleared their membership.
export default function WelcomeScreen() {
  const signOut = useSignOut();
  const session = useSession();
  const membership = useGymMembership();
  const queryClient = useQueryClient();
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Recovered from the signup metadata — when present, the user finished
  // email confirmation and we have everything to finish the job: gym
  // name/slug/colours for a create, or the slug for a join.
  const pendingGym = pendingGymFromSession(session ?? null);
  const pendingJoin = pendingJoinFromSession(session ?? null);

  const resume = useMutation({
    mutationFn: async () => {
      if (pendingGym) {
        await completePendingGym(pendingGym);
        return;
      }
      if (pendingJoin) {
        await completePendingJoin(pendingJoin);
        return;
      }
      throw new Error('Nothing to resume');
    },
    onSuccess: async () => {
      setResumeError(null);
      await refreshMembership(queryClient);
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      router.replace('/' as never);
    },
    onError: (e) =>
      setResumeError(errorMessage(e, 'Could not finish setting up your gym')),
  });

  // Landing here with a session means the membership lookup returned
  // nothing — which has two very different causes (RLS/empty vs a
  // thrown query). Surface which one, plus the ids involved, so a
  // screenshot of this screen is a complete diagnostic. Cheap, always
  // on, and only visible on a page that already means "something's off".
  const diagnostic = membership.isError
    ? `Membership lookup FAILED: ${String(
        (membership.error as Error)?.message ?? membership.error,
      )}`
    : membership.isLoading
      ? 'Membership lookup still loading…'
      : `Membership lookup returned no active membership.`;

  const resumable = pendingGym ?? pendingJoin;

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 p-6">
        <View className="gap-2 items-center">
          <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
            Welcome
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            {pendingGym
              ? `You're signed in. Pick up where you left off — finish setting up ${pendingGym.name}.`
              : pendingJoin
                ? "You're signed in. Finish joining your gym."
                : "You're signed in but not in a gym yet. Create one or join with an invite."}
          </Text>
        </View>
        <View className="w-full max-w-xs gap-3">
          {resumable ? (
            <View className="gap-2">
              <Button onPress={() => resume.mutate()} loading={resume.isPending}>
                {pendingGym
                  ? `Finish creating ${pendingGym.name}`
                  : 'Finish joining'}
              </Button>
              {resumeError ? (
                <Text className="text-red-500 dark:text-red-400 text-sm text-center">
                  {resumeError}
                </Text>
              ) : null}
              {pendingGym ? (
                <Pressable onPress={() => router.push('/create-gym' as never)}>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm text-center pt-1">
                    Edit the gym name or slug first
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Link href="/create-gym" asChild>
              <Pressable className="bg-primary rounded-lg p-3 items-center active:opacity-80">
                <Text className="text-white font-semibold">Start a new gym</Text>
              </Pressable>
            </Link>
          )}
          <Link href="/accept-invite" asChild>
            <Pressable className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 items-center active:opacity-80">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Use an invite code
              </Text>
            </Pressable>
          </Link>
          <Pressable
            onPress={() => signOut.mutate()}
            className="self-center pt-2">
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Sign out
            </Text>
          </Pressable>
        </View>
        <View className="gap-1 items-center pt-6 px-4">
          <Text className="text-gray-400 dark:text-gray-600 text-xs text-center font-mono">
            {diagnostic}
          </Text>
          <Text className="text-gray-400 dark:text-gray-600 text-xs text-center font-mono">
            user: {session?.user.id ?? 'none'} · {session?.user.email ?? ''}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
