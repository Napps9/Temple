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
import { LegalConsentNotice } from '@/components/LegalConsentNotice';
import { Screen } from '@/components/Screen';
import {
  joinGymBySlug,
  joinGymWithSignup,
  refreshMembership,
  resendConfirmation,
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
  const { slug, name: nameParam, email: emailParam } = useLocalSearchParams<{
    slug: string;
    name?: string;
    email?: string;
  }>();
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

  // Pre-seeded when the AI agent sends a personalised onboarding link; the
  // member still sets their own password and personally signs the waiver + PAR-Q.
  const [fullName, setFullName] = useState(() =>
    typeof nameParam === 'string' ? nameParam : '',
  );
  const [email, setEmail] = useState(() =>
    typeof emailParam === 'string' ? emailParam : '',
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  // One-time sign-in links die when they expire or an email scanner
  // pre-opens them; Supabase bounces here with the reason in the URL hash.
  // Surface it and offer a fresh link rather than a dead-end signup form
  // (the account already exists, so signing up again would fail too).
  const [linkExpired] = useState<boolean>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    const h = window.location.hash ?? '';
    return h.includes('error_code=otp_expired') || h.includes('error=access_denied');
  });
  const [freshLinkNotice, setFreshLinkNotice] = useState<string | null>(null);
  const [freshLinkLoading, setFreshLinkLoading] = useState(false);

  async function sendFreshLink() {
    if (!email.trim()) {
      setError('Enter your email above first.');
      return;
    }
    setFreshLinkLoading(true);
    setError(null);
    try {
      const redirect =
        typeof window !== 'undefined'
          ? window.location.origin + window.location.pathname + window.location.search
          : undefined;
      const { error: e } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      });
      if (e) throw e;
      setFreshLinkNotice('Sent — check your inbox for a fresh sign-in link.');
    } catch (e) {
      setError(errorMessage(e, 'Could not send a new link'));
    } finally {
      setFreshLinkLoading(false);
    }
  }

  const signupAndJoin = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error('Missing slug');
      if (!fullName.trim()) throw new Error('Your name is required');
      if (!email.trim() || !password) {
        throw new Error('Email and password are required');
      }
      return joinGymWithSignup({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        slug,
      });
    },
    onSuccess: async (result) => {
      if (result.status === 'pending_confirmation') {
        setPendingEmail(result.email);
        setResendNotice(null);
        setError(null);
        return;
      }
      await refreshMembership(queryClient);
      router.replace('/' as never);
    },
    onError: (e) =>
      setError(errorMessage(e, 'Could not join the gym')),
  });

  async function resend() {
    if (!pendingEmail) return;
    setResendNotice(null);
    setError(null);
    setResendLoading(true);
    try {
      await resendConfirmation(pendingEmail);
      setResendNotice('Sent — check your inbox (and spam folder).');
    } catch (e) {
      setError(errorMessage(e, 'Could not resend the confirmation email'));
    } finally {
      setResendLoading(false);
    }
  }

  const justJoin = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error('Missing slug');
      await joinGymBySlug(slug);
    },
    onSuccess: async () => {
      await refreshMembership(queryClient);
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
            Public signup is disabled. Ask your gym to email you an invite.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="py-8 px-4">
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
            ) : pendingEmail ? (
              <View className="gap-4">
                <View className="gap-2">
                  <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                    Check your email
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400">
                    We sent a confirmation link to{' '}
                    <Text className="text-gray-900 dark:text-gray-50 font-medium">
                      {pendingEmail}
                    </Text>
                    . Click it, then come back and sign in — you'll land
                    straight into {info.name}.
                  </Text>
                </View>
                {resendNotice ? (
                  <Text className="text-emerald-600 dark:text-emerald-400 text-sm">
                    {resendNotice}
                  </Text>
                ) : null}
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={resend}
                  disabled={resendLoading}
                  className="rounded-lg px-5 py-3 items-center justify-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 active:opacity-80">
                  <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                    {resendLoading ? 'Sending…' : 'Resend confirmation email'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setPendingEmail(null);
                    setResendNotice(null);
                    setError(null);
                    setEmail('');
                    setPassword('');
                  }}
                  className="self-center">
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Use a different email
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-4">
                {linkExpired ? (
                  <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 gap-2">
                    <Text className="text-amber-800 dark:text-amber-300 text-sm">
                      That sign-in link has expired or was already used.
                    </Text>
                    {freshLinkNotice ? (
                      <Text className="text-emerald-600 dark:text-emerald-400 text-sm">
                        {freshLinkNotice}
                      </Text>
                    ) : (
                      <Pressable
                        hitSlop={8}
                        onPress={sendFreshLink}
                        disabled={freshLinkLoading}
                        accessibilityRole="button">
                        <Text className="text-primary text-sm">
                          {freshLinkLoading ? 'Sending…' : 'Email me a fresh link'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
                <Input
                  label="Your name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  textContentType="name"
                  autoComplete="name"
                />
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
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
                <LegalConsentNotice />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
