import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TempleLockup } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  completePendingGym,
  completePendingInvite,
  completePendingJoin,
  pendingGymFromSession,
  pendingInviteFromSession,
  pendingJoinFromSession,
  refreshMembership,
  useGymMembership,
  useSession,
  useSignOut,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useThemeColors } from '@/lib/theme';

// Shown when a user is signed in but has no gym membership yet — either
// they just confirmed an email from the create-gym or join flow (and we
// finish the job, fully branded, in one tap), they joined via
// /join/[slug] but the binding failed, or they cleared their membership.
export default function WelcomeScreen() {
  const colors = useThemeColors();
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
  const pendingInvite = pendingInviteFromSession(session ?? null);
  const resumable = pendingGym ?? pendingJoin ?? pendingInvite;

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
      if (pendingInvite) {
        await completePendingInvite(pendingInvite);
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

  const joining = pendingJoin || pendingInvite;
  const icon = pendingGym
    ? 'business-outline'
    : joining
      ? 'people-outline'
      : 'compass-outline';
  const heading = pendingGym
    ? `Finish setting up ${pendingGym.name}`
    : joining
      ? 'Finish joining your gym'
      : "You're not in a gym yet";
  const subcopy = pendingGym
    ? "Email confirmed. Pick up where you left off — one tap and your gym is ready."
    : joining
      ? "Email confirmed. One tap to join and you're in."
      : 'Create your own gym, or open the invite your gym emailed you to join theirs.';

  return (
    <SafeAreaView
      className="flex-1 bg-ground dark:bg-ground-dk"
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
            <TempleLockup size={28} />
          </View>

          <View className="items-center gap-4">
            <View className="w-16 h-16 rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk items-center justify-center">
              <Ionicons name={icon} size={28} color={colors.ink} />
            </View>
            <View className="gap-2">
              <Text className="text-ink dark:text-ink-dk text-2xl font-semibold text-center">
                {heading}
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-center leading-5">
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
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      Edit the gym name or slug first
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Button
                onPress={() => router.push('/create-gym' as never)}
                icon="business-outline">
                Start a new gym
              </Button>
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
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              Signed in as {session?.user.email ?? 'your account'}
            </Text>
            <Pressable
              onPress={() => signOut.mutate()}
              hitSlop={8}
              className="py-1">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Sign out
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
