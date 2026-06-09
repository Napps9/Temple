import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { GymLogo } from '@/components/GymLogo';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import {
  joinGymBySlug,
  joinGymWithSignup,
  useSession,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type GymInfo = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  text_color: string;
  public_signup_enabled: boolean;
};

export default function JoinGymScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const session = useSession();
  const queryClient = useQueryClient();

  const gym = useQuery({
    queryKey: ['gym-by-slug', slug],
    enabled: !!slug,
    queryFn: async (): Promise<GymInfo | null> => {
      const { data, error } = await supabase.rpc('gym_by_slug', {
        p_slug: slug!,
      });
      if (error) throw error;
      const rows = (data ?? []) as GymInfo[];
      return rows[0] ?? null;
    },
  });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signupAndJoin = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error('Missing slug');
      if (!fullName.trim()) throw new Error('Your name is required');
      if (!email.trim() || !password) {
        throw new Error('Email and password are required');
      }
      await joinGymWithSignup({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        slug,
      });
    },
    onSuccess: async () => {
      // refetch (not invalidate) — useGymMembership is pinned to
      // refetchOnMount: false so an invalidate-then-redirect race leaves
      // the cache as null and bounces the joined member back to /welcome.
      await queryClient.refetchQueries({ queryKey: ['gym-membership'] });
      router.replace('/' as never);
    },
    onError: (e) =>
      setError(errorMessage(e, 'Could not join the gym')),
  });

  const justJoin = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error('Missing slug');
      await joinGymBySlug(slug);
    },
    onSuccess: async () => {
      // refetch (not invalidate) — useGymMembership is pinned to
      // refetchOnMount: false so an invalidate-then-redirect race leaves
      // the cache as null and bounces the joined member back to /welcome.
      await queryClient.refetchQueries({ queryKey: ['gym-membership'] });
      router.replace('/' as never);
    },
    onError: (e) =>
      setError(errorMessage(e, 'Could not join the gym')),
  });

  if (gym.isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        </View>
      </Screen>
    );
  }

  const info = gym.data;
  if (!info) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Gym not found
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            Double-check the link from your gym, or sign in if you already have
            an account.
          </Text>
          <Link href="/sign-in" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-primary">Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </Screen>
    );
  }

  const primary = info.primary_color;

  if (!info.public_signup_enabled) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <GymLogo
            size={64}
            logoUrl={info.logo_url}
            name={info.name}
            primaryColor={primary}
          />
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            {info.name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            Public signup is disabled. Ask your gym to send you an invite code.
          </Text>
          <Link href="/accept-invite" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-primary">Use an invite code</Text>
            </Pressable>
          </Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="py-8">
          <View className="gap-6 w-full max-w-md mx-auto">
            <View className="items-center gap-3 pt-4">
              <GymLogo
                size={64}
                logoUrl={info.logo_url}
                name={info.name}
                primaryColor={primary}
              />
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                You're joining
              </Text>
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                {info.name}
              </Text>
            </View>

            {session ? (
              <View className="gap-4">
                <Text className="text-gray-500 dark:text-gray-400 text-center">
                  You're already signed in. One tap to add yourself to{' '}
                  {info.name}.
                </Text>
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
                ) : null}
                <Pressable
                  onPress={() => justJoin.mutate()}
                  disabled={justJoin.isPending}
                  style={{ backgroundColor: primary }}
                  className="rounded-lg px-5 py-3 items-center justify-center active:opacity-80">
                  <Text className="text-white font-semibold">
                    {justJoin.isPending ? 'Joining…' : `Join ${info.name}`}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-4">
                <Input
                  label="Your name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  textContentType="name"
                />
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                />
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
                ) : null}
                <Pressable
                  onPress={() => signupAndJoin.mutate()}
                  disabled={signupAndJoin.isPending}
                  style={{ backgroundColor: primary }}
                  className="rounded-lg px-5 py-3 items-center justify-center active:opacity-80">
                  <Text className="text-white font-semibold">
                    {signupAndJoin.isPending
                      ? 'Joining…'
                      : `Sign up and join ${info.name}`}
                  </Text>
                </Pressable>
                <View className="items-center">
                  <Link href="/sign-in" asChild>
                    <Pressable hitSlop={8}>
                      <Text className="text-primary text-sm">
                        Already have an account? Sign in
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
