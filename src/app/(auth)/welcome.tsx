import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TempleLockup } from '@/components/TempleLockup';
import { ThemeToggle } from '@/components/ThemeToggle';
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
import { useThemeColors } from '@/lib/theme';

// Temple steel blue (the company mark's middle card) — this screen is
// brandless chrome (the user has no gym yet), so it wears Temple's own
// colour, the same as the logged-out landing.
const BLUE = '#3B6BA5';

// Shown when a user is signed in but has no gym membership yet — either
// they just confirmed an email from the create-gym or join flow (and we
// finish the job, fully branded, in one tap), they joined via
// /join/[slug] but the binding failed, or they cleared their membership.
export default function WelcomeScreen() {
  const signOut = useSignOut();
  const session = useSession();
  const membership = useGymMembership();
  const queryClient = useQueryClient();
  const colors = useThemeColors();
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Recovered from the signup metadata — when present, the user finished
  // email confirmation and we have everything to finish the job: gym
  // name/slug/colours for a create, or the slug for a join.
  const pendingGym = pendingGymFromSession(session ?? null);
  const pendingJoin = pendingJoinFromSession(session ?? null);
  const resumable = pendingGym ?? pendingJoin;

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

  const icon = pendingGym
    ? 'business-outline'
    : pendingJoin
      ? 'people-outline'
      : 'compass-outline';
  const heading = pendingGym
    ? `Finish setting up ${pendingGym.name}`
    : pendingJoin
      ? 'Finish joining your gym'
      : "You're not in a gym yet";
  const subcopy = pendingGym
    ? "Email confirmed. Pick up where you left off — one tap and your gym is ready."
    : pendingJoin
      ? "Email confirmed. One tap to join and you're in."
      : 'Create your own gym or join one with an invite code — you can switch later.';

  return (
    <SafeAreaView
      className="flex-1 bg-slate-100 dark:bg-gray-950"
      edges={['top', 'bottom', 'left', 'right']}>
      <View className="absolute top-3 right-3 z-10">
        <ThemeToggle />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 32,
        }}>
        <View className="w-full max-w-sm mx-auto gap-8">
          <View className="items-center">
            <TempleLockup width={196} height={49} />
          </View>

          <View className="items-center gap-4">
            <View
              style={{ backgroundColor: BLUE + '1A', borderColor: BLUE + '40' }}
              className="w-16 h-16 rounded-2xl border items-center justify-center">
              <Ionicons name={icon} size={28} color={BLUE} />
            </View>
            <View className="gap-2">
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold text-center">
                {heading}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-center leading-5">
                {subcopy}
              </Text>
            </View>
          </View>

          <View className="gap-3">
            {resumable ? (
              <>
                <Button
                  onPress={() => resume.mutate()}
                  loading={resume.isPending}
                  icon="arrow-forward">
                  {pendingGym
                    ? `Finish creating ${pendingGym.name}`
                    : 'Finish joining'}
                </Button>
                {pendingGym ? (
                  <Pressable
                    onPress={() => router.push('/create-gym' as never)}
                    hitSlop={6}
                    className="items-center py-1">
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">
                      Edit the gym name or slug first
                    </Text>
                  </Pressable>
                ) : null}
                <Link href="/accept-invite" asChild>
                  <Pressable className="flex-row items-center justify-center gap-2 rounded-lg p-4 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 active:opacity-80">
                    <Ionicons name="ticket-outline" size={18} color={colors.iconPrimary} />
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                      Use an invite code instead
                    </Text>
                  </Pressable>
                </Link>
              </>
            ) : (
              <>
                <Button
                  onPress={() => router.push('/create-gym' as never)}
                  icon="business-outline">
                  Start a new gym
                </Button>
                <Link href="/accept-invite" asChild>
                  <Pressable className="flex-row items-center justify-center gap-2 rounded-lg p-4 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 active:opacity-80">
                    <Ionicons name="ticket-outline" size={18} color={colors.iconPrimary} />
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                      Use an invite code
                    </Text>
                  </Pressable>
                </Link>
              </>
            )}

            {resumeError ? (
              <Text className="text-red-500 dark:text-red-400 text-sm text-center">
                {resumeError}
              </Text>
            ) : null}
            {membership.isError ? (
              <Text className="text-amber-600 dark:text-amber-400 text-sm text-center">
                We couldn't load your gym just now. Check your connection and
                try again.
              </Text>
            ) : null}
          </View>

          <View className="items-center gap-1 pt-2">
            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              Signed in as {session?.user.email ?? 'your account'}
            </Text>
            <Pressable
              onPress={() => signOut.mutate()}
              hitSlop={8}
              className="py-1">
              <Text className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                Sign out
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
