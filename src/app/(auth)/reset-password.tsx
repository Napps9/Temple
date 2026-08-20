import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Phase = 'checking' | 'ready' | 'invalid';

// The Supabase client is a module-level singleton that starts parsing the
// recovery link's URL fragment as soon as it's constructed — which can
// happen (and complete) before this screen even mounts, let alone before
// its effect below subscribes. So "ready" is driven by two redundant
// signals: an immediate getSession() read (covers the URL already having
// been processed) plus an onAuthStateChange subscription (covers it still
// being in flight). Whichever resolves first wins; only the absence of
// both within the wait window means the link was genuinely bad.
const RECOVERY_WAIT_MS = 5000;

export default function ResetPasswordScreen() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setPhase('ready');
    });
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setPhase('ready');
    });
    const timeout = setTimeout(() => {
      setPhase((p) => (p === 'checking' ? 'invalid' : p));
    }, RECOVERY_WAIT_MS);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function onSubmit() {
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.replace('/' as never);
    } catch (e) {
      setError(errorMessage(e, 'Could not update password'));
    } finally {
      setLoading(false);
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
            <TempleLockup size={28} />
            <View className="items-center gap-1">
              <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
                Choose a new password
              </Text>
              {phase === 'ready' ? (
                <Text className="text-ink-2 dark:text-ink-2-dk">
                  Pick something you haven't used before.
                </Text>
              ) : null}
            </View>
          </View>

          {phase === 'checking' ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-center">
              Verifying your reset link…
            </Text>
          ) : null}

          {phase === 'invalid' ? (
            <View className="gap-4">
              <Text className="text-ink-2 dark:text-ink-2-dk text-center">
                This link isn't valid or has expired. Request a new one and
                try again.
              </Text>
              <Button onPress={() => router.replace('/forgot-password' as never)}>
                Request a new link
              </Button>
            </View>
          ) : null}

          {phase === 'ready' ? (
            <>
              <View className="gap-4">
                <Input
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <Input
                  label="Confirm password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
              </View>
              {error ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-red-500 dark:text-red-400 text-sm">
                  {error}
                </Text>
              ) : null}
              <Button onPress={onSubmit} loading={loading}>
                Update password
              </Button>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
