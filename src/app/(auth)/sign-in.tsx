import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleLockup';
import { ThemeToggle } from '@/components/ThemeToggle';
import { resendConfirmation, signIn } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True iff the last attempt failed with "invalid credentials" — the
  // message Supabase returns for both wrong passwords and unconfirmed
  // accounts. The Resend hint sits under it so a stuck user can recover
  // without leaving the page.
  const [recoverable, setRecoverable] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setResendNotice(null);
    setRecoverable(false);
    setLoading(true);
    try {
      await signIn(email, password);
      // Navigate explicitly — the (auth) layout redirect only fires for
      // users WITH a membership, so a gymless account would otherwise sit
      // here. Root index routes by role / membership.
      router.replace('/' as never);
    } catch (e) {
      const msg = errorMessage(e, 'Sign-in failed');
      setError(msg);
      if (/invalid login/i.test(msg) || /not confirmed|confirm/i.test(msg)) {
        setRecoverable(true);
      }
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!email.trim()) {
      setError('Type your email above before resending the confirmation.');
      return;
    }
    setResendNotice(null);
    setError(null);
    setResendLoading(true);
    try {
      await resendConfirmation(email.trim());
      setResendNotice('Sent — check your inbox (and spam folder).');
    } catch (e) {
      setError(errorMessage(e, 'Could not resend the confirmation email'));
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <Screen>
      <View className="absolute top-3 right-3 z-10">
        <ThemeToggle />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-4">
        <View className="gap-6 w-full max-w-md mx-auto">
          <View className="items-center gap-3">
            <TempleLockup />
            <View className="items-center gap-1">
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
                Welcome back
              </Text>
              <Text className="text-gray-500 dark:text-gray-400">
                Sign in to continue
              </Text>
            </View>
          </View>

          <View className="gap-4">
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
              textContentType="password"
              autoComplete="current-password"
            />
          </View>

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}
          {resendNotice ? (
            <Text className="text-emerald-600 dark:text-emerald-400 text-sm">
              {resendNotice}
            </Text>
          ) : null}
          {recoverable && !resendNotice ? (
            <Pressable hitSlop={8} onPress={resend} disabled={resendLoading}>
              <Text className="text-primary text-sm">
                {resendLoading
                  ? 'Sending…'
                  : 'Didn’t get the confirmation email? Resend it'}
              </Text>
            </Pressable>
          ) : null}

          <Button onPress={onSubmit} loading={loading}>
            Sign in
          </Button>

          <View className="items-center">
            <Link href="/get-started" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">New to Temple? Get started</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
