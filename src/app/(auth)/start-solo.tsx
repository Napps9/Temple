import { useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { LegalConsentNotice } from '@/components/LegalConsentNotice';
import { Screen } from '@/components/Screen';
import {
  confirmRedirectTo,
  refreshMembership,
  resendConfirmation,
  useSession,
} from '@/lib/auth';
import { isMinor } from '@/lib/consent';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Solo signup. Smaller cousin of /create-gym — name + email + password,
// then activates the athlete subscription. If email confirmation is on,
// we surface a Check Your Email panel; once the user confirms and signs
// in they land on /athlete which already prompts to activate, so no
// metadata stash is needed for resume.
export default function StartSoloScreen() {
  const session = useSession();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  // If they're already signed in, skip the form and just activate.
  async function activateAndGo() {
    setError(null);
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('start_athlete_subscription');
      if (e) throw e;
      await refreshMembership(queryClient);
      router.replace('/athlete' as never);
    } catch (e) {
      setError(errorMessage(e, 'Could not start solo tracking'));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit() {
    setError(null);
    if (session) {
      await activateAndGo();
      return;
    }
    if (!fullName.trim()) {
      setError('Your name is required');
      return;
    }
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    // Solo is a direct contract with Temple — no gym, no guardian path — so
    // it is strictly 18+. (Under-18s train through a gym that opts in.)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setError('Please enter your date of birth');
      return;
    }
    if (isMinor(dob)) {
      setError(
        'You must be 18 or over to sign up for solo tracking. If you train ' +
          'at a gym, ask them to invite you.',
      );
      return;
    }
    setLoading(true);
    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: confirmRedirectTo(),
          data: { full_name: fullName.trim(), intent: 'solo', date_of_birth: dob },
        },
      });
      if (signUpErr) throw signUpErr;
      if (!data.session) {
        // Try the password sign-in fallback for projects with email
        // confirmation off. If that fails too, this is the pending state.
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) {
          setPendingEmail(email.trim());
          setResendNotice(null);
          return;
        }
      }
      // Persist DOB now that we're authenticated (the 18+ gate already
      // passed); auth metadata also carries it. Best-effort.
      const { data: authed } = await supabase.auth.getUser();
      if (authed.user) {
        await supabase
          .from('profiles')
          .update({ date_of_birth: dob })
          .eq('id', authed.user.id);
      }
      const { error: rpcErr } = await supabase.rpc('start_athlete_subscription');
      if (rpcErr) throw rpcErr;
      await refreshMembership(queryClient);
      router.replace('/athlete' as never);
    } catch (e) {
      setError(errorMessage(e, 'Could not start solo tracking'));
    } finally {
      setLoading(false);
    }
  }

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

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="py-8 px-4">
          <View className="gap-6 w-full max-w-md mx-auto">
            <View className="gap-2">
              <Text className="text-amber-500 text-[10px] font-semibold uppercase tracking-widest">
                Solo · free in beta
              </Text>
              <Text className="text-ink dark:text-ink-dk text-3xl font-semibold">
                Keep pushing.
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk">
                Log workouts, track PRs, keep your streak alive — even when
                you're between gyms. Your history is always yours.
              </Text>
            </View>

            {pendingEmail ? (
              <View className="gap-4 bg-surface dark:bg-surface-dk rounded-xl p-5 shadow-card">
                <View className="gap-2">
                  <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
                    Check your email
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk">
                    We sent a confirmation link to{' '}
                    <Text className="text-ink dark:text-ink-dk font-medium">
                      {pendingEmail}
                    </Text>
                    . Click it, then sign in — we'll set up solo tracking on
                    your first visit.
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
                <Button
                  variant="secondary"
                  onPress={resend}
                  loading={resendLoading}>
                  Resend confirmation email
                </Button>
                <Pressable
                  onPress={() => {
                    setPendingEmail(null);
                    setResendNotice(null);
                    setError(null);
                    setEmail('');
                    setPassword('');
                  }}
                  className="self-center">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Use a different email
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-4">
                {!session ? (
                  <>
                    <Input
                      label="Your name"
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      textContentType="name"
                      autoComplete="name"
                    />
                    <DatePicker
                      label="Date of birth"
                      value={dob}
                      onChange={setDob}
                      max={new Date().toISOString().slice(0, 10)}
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
                  </>
                ) : (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Signed in as {session.user.email}. Tap below to activate.
                  </Text>
                )}
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {error}
                  </Text>
                ) : null}
                <Button onPress={onSubmit} loading={loading}>
                  {session ? 'Start solo tracking' : 'Create account and start'}
                </Button>
                {!session ? <LegalConsentNotice /> : null}
              </View>
            )}

            <View className="items-center pt-2">
              <Link href="/get-started" asChild>
                <Pressable hitSlop={8}>
                  <Text className="text-primary text-sm">
                    Back to all three options
                  </Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
