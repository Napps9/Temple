import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useGymMembership, useSession, useSignOut } from '@/lib/auth';

// Shown when a user is signed in but has no gym membership yet —
// either they just created an auth account via /join/[slug] that
// failed to bind, or they cleared their membership somewhere.
// Offers the same three choices as the sign-in page so they can
// pick a path forward.
export default function WelcomeScreen() {
  const signOut = useSignOut();
  const session = useSession();
  const membership = useGymMembership();

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

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 p-6">
        <View className="gap-2 items-center">
          <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
            Welcome
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            You're signed in but not in a gym yet. Create one or join with an
            invite.
          </Text>
        </View>
        <View className="w-full max-w-xs gap-3">
          <Link href="/create-gym" asChild>
            <Pressable className="bg-primary rounded-lg p-3 items-center active:opacity-80">
              <Text className="text-white font-semibold">Start a new gym</Text>
            </Pressable>
          </Link>
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
