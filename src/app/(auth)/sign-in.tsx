import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { BrandHeadline } from '@/components/BrandHeadline';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { TempleLockup } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { resendConfirmation, signIn } from '@/lib/auth';
import { recordDemoAuthentication, setDemoVisitor } from '@/lib/demo-visit';
import { errorMessage } from '@/lib/errors';

// Keep the keys in sync with FEATURE_DEMO_TARGETS in the marketing site
// repo. The origin check below is what stops anyone but the marketing site
// from triggering this at all; this allowlist is defense-in-depth on
// top of that, so even a sender bug can't redirect a demo sign-in
// anywhere but a screen we've actually chosen to demo.
//
// A map rather than a set because /management/branding is retired — the
// panel lives in the Manage screen's Settings tab now. The marketing site
// is a separate repo on its own deploy cadence, so the key stays what it
// already sends and the value is where that actually lands today.
//
// Drift here is silent, and it had already happened: the marketing site's
// scheduling, marketing and operations feature previews were sending
// /book, /management/communications and /management, none of which were
// in this map, so all three landed on / — a miss falls back rather than
// erroring. If you retire a screen, keep its key and repoint the value:
// never drop the row.
const DEMO_REDIRECTS = new Map([
  ['/book', '/book'],
  ['/track', '/track'],
  ['/programming', '/programming'],
  ['/timeline', '/timeline'],
  ['/management', '/management'],
  ['/management/leads', '/management/leads'],
  ['/management/plans', '/management/plans'],
  ['/management/billing', '/management/billing'],
  ['/management/communications', '/management/communications'],
  ['/management/branding', '/management?section=branding'],
]);

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
  // Set by the message listener below when the marketing site names a
  // specific screen (e.g. a feature page's "see it live" link) — read
  // once, on successful sign-in, in onSubmit.
  const demoRedirectRef = useRef<string | null>(null);

  // Web only: the marketing site's homepage demo embeds this screen in
  // an iframe and can postMessage a demo account into it so a visitor
  // doesn't have to retype what's already shown on that page. This only
  // ever prefills — it never submits — so a real click on "Sign in"
  // below is still required. contentWindow.postMessage is the one
  // cross-origin capability the marketing site actually has here (it
  // cannot reach into this page's DOM directly), so this listener is
  // the other half of that channel. Origin-checked so only the
  // marketing site can trigger it.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== 'https://jointemple.io' &&
        event.origin !== 'https://www.jointemple.io'
      ) {
        return;
      }
      const data = event.data as
        | {
            type?: string;
            email?: string;
            password?: string;
            redirect?: string;
            visitor?: string;
          }
        | undefined;
      if (data?.type !== 'temple-demo-autofill') return;
      if (typeof data.email === 'string') setEmail(data.email);
      if (typeof data.password === 'string') setPassword(data.password);
      if (typeof data.redirect === 'string') {
        demoRedirectRef.current = DEMO_REDIRECTS.get(data.redirect) ?? null;
      }
      // Only present when the visitor accepted the marketing site's cookie
      // banner; without it the demo half of the funnel is still counted,
      // just not joined to the visit that started it (0279). Validated as a
      // uuid on the way in — the sender is checked by origin above, but the
      // value still goes into a query.
      setDemoVisitor(data.visitor);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function onSubmit() {
    setError(null);
    setResendNotice(null);
    setRecoverable(false);
    setLoading(true);
    try {
      await signIn(email, password);
      // Only for a sign-in the marketing site set up, so an ordinary one
      // pays nothing for it. record_demo_event refuses a gym that is not a
      // demo tenant, so a stale ref cannot make this record a real gym.
      if (demoRedirectRef.current) {
        void recordDemoAuthentication(demoRedirectRef.current);
      }
      // Navigate explicitly — the (auth) layout redirect only fires for
      // users WITH a membership, so a gymless account would otherwise sit
      // here. Root index routes by role / membership. A demo redirect
      // (see the message listener above) takes priority when present.
      router.replace((demoRedirectRef.current ?? '/') as never);
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
            <TempleLockup size={28} />
            <View className="items-center gap-1">
              <BrandHeadline className="text-2xl font-semibold">
                Welcome back
              </BrandHeadline>
              <Text className="text-ink-2 dark:text-ink-2-dk">
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
            <Link href="/forgot-password" asChild>
              <Pressable hitSlop={8} accessibilityRole="button" className="self-end">
                <Text className="text-link text-sm font-medium">Forgot password?</Text>
              </Pressable>
            </Link>
          </View>

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}
          {resendNotice ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-emerald-600 dark:text-emerald-400 text-sm">
              {resendNotice}
            </Text>
          ) : null}
          {recoverable && !resendNotice ? (
            <View className="gap-2">
              <Pressable
                hitSlop={8}
                onPress={resend}
                disabled={resendLoading}
                accessibilityRole="button">
                <Text className="text-link text-sm font-medium">
                  {resendLoading
                    ? 'Sending…'
                    : 'Didn’t get the confirmation email? Resend it'}
                </Text>
              </Pressable>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Joined through an email link? You may not have a password yet —
                use “Forgot password?” above to set one.
              </Text>
            </View>
          ) : null}

          <Button onPress={onSubmit} loading={loading}>
            Sign in
          </Button>

          <View className="items-center">
            <Link href="/get-started" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-link font-medium">New to Temple? Get started</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
