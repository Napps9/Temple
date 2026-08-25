import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { LegalConsentNotice } from '@/components/LegalConsentNotice';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { TempleMark } from '@/components/TempleMark';
import { Text } from '@/components/Text';
import { completePendingTrial, redeemTrialWithSignup, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Offer = {
  gym_id: string;
  gym_name: string;
  gym_slug: string;
  kind: string;
  class_type_id: string | null;
  class_type_name: string | null;
  session_id: string | null;
  session_name: string | null;
  starts_at: string | null;
  duration_minutes: number | null;
  coach_name: string | null;
  passes: number;
  invited_first_name: string | null;
};

type OfferSession = {
  session_id: string;
  session_name: string;
  starts_at: string;
  duration_minutes: number;
  coach_name: string | null;
  spaces_left: number;
};

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The free-class link, from the claimant's side. It is the only screen
// in the product where somebody with no account can take a seat, so it
// says what they are getting before it asks for anything, and it is
// honest about what happens next: the seat is held, and the gym's
// health forms come before the class.
//
// A dead link says "this link has expired" and nothing else. The offer
// RPC returns no row for unknown, revoked, spent and past tokens alike
// — a page that distinguished them would answer questions about the
// gym for anyone who guessed.
export default function TrialClaimScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const session = useSession();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pickedSession, setPickedSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ when: string | null } | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  const offer = useQuery({
    queryKey: ['trial-offer', token],
    enabled: !!token,
    queryFn: async (): Promise<Offer | null> => {
      const { data, error: e } = await supabase.rpc('trial_pass_offer', {
        p_token: token!,
      });
      if (e) throw e;
      return ((data ?? []) as Offer[])[0] ?? null;
    },
  });

  const needsPick = !!offer.data && !offer.data.session_id;
  const sessions = useQuery({
    queryKey: ['trial-sessions', token],
    enabled: !!token && needsPick,
    queryFn: async (): Promise<OfferSession[]> => {
      const { data, error: e } = await supabase.rpc('trial_pass_sessions', {
        p_token: token!,
      });
      if (e) throw e;
      return (data ?? []) as OfferSession[];
    },
  });

  const targetSession = offer.data?.session_id ?? pickedSession;
  const targetWhen =
    offer.data?.starts_at ??
    (sessions.data ?? []).find((s) => s.session_id === pickedSession)?.starts_at ??
    null;

  const claim = useMutation({
    mutationFn: async () => {
      if (needsPick && !pickedSession) {
        throw new Error('Pick a class first');
      }
      if (session) {
        return completePendingTrial({
          token: token!,
          sessionId: targetSession ?? null,
        });
      }
      return redeemTrialWithSignup({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        token: token!,
        sessionId: targetSession ?? null,
      });
    },
    onSuccess: (res) => {
      setError(null);
      if (res.status === 'pending_confirmation') {
        setCheckEmail(res.email);
        return;
      }
      setClaimed({ when: targetWhen });
    },
    onError: (e) => setError(errorMessage(e, 'Could not claim this class')),
  });

  if (offer.isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        </View>
      </Screen>
    );
  }

  if (!offer.data) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <TempleMark size={56} />
          <Text className="text-ink dark:text-ink-dk text-xl font-semibold text-center">
            This link has expired
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            Ask the gym for a fresh one — they can send another in a moment.
          </Text>
          <Link href="/sign-in" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-link font-medium">Sign in</Text>
            </Pressable>
          </Link>
        </View>
      </Screen>
    );
  }

  const info = offer.data;

  if (checkEmail) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <TempleMark size={56} />
          <Text className="text-ink dark:text-ink-dk text-xl font-semibold text-center">
            Check your email
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            We've sent a confirmation link to {checkEmail}. Open it and your
            free class at {info.gym_name} is waiting.
          </Text>
        </View>
      </Screen>
    );
  }

  if (claimed) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <TempleMark size={56} />
          <Text className="text-ink dark:text-ink-dk text-xl font-semibold text-center">
            Your spot is held
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            {claimed.when ? `${whenLabel(claimed.when)} at ` : 'At '}
            {info.gym_name}. Two short forms — a health screening and the
            waiver — and you're booked in.
          </Text>
          <Button onPress={() => router.replace('/' as never)}>Continue</Button>
        </View>
      </Screen>
    );
  }

  const greeting = info.invited_first_name
    ? `${info.invited_first_name}, your free class`
    : 'Your free class';

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="py-8 px-4">
          <View className="gap-6 w-full max-w-md mx-auto">
            <View className="items-center gap-3 pt-4">
              <TempleMark size={56} />
              <FieldLabel>{greeting}</FieldLabel>
              <Text className="text-ink dark:text-ink-dk text-2xl font-semibold text-center">
                {info.gym_name}
              </Text>
              {info.session_id && info.starts_at ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-center text-sm">
                  {info.class_type_name ?? info.session_name} ·{' '}
                  {whenLabel(info.starts_at)}
                  {info.coach_name ? ` · with ${info.coach_name}` : ''}
                </Text>
              ) : (
                <Text className="text-ink-2 dark:text-ink-2-dk text-center text-sm">
                  {info.class_type_name ?? 'Any class'} — pick the one that
                  suits you.
                </Text>
              )}
            </View>

            {needsPick ? (
              <View className="gap-2">
                <FieldLabel>Pick a class</FieldLabel>
                {sessions.isLoading ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Loading classes…
                  </Text>
                ) : (sessions.data ?? []).length === 0 ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Nothing on the timetable yet — check back shortly, or ask
                    the gym.
                  </Text>
                ) : (
                  (sessions.data ?? []).map((s) => {
                    const picked = pickedSession === s.session_id;
                    const full = s.spaces_left <= 0;
                    return (
                      <Pressable
                        key={s.session_id}
                        disabled={full}
                        onPress={() => setPickedSession(s.session_id)}
                        className={`rounded-card border p-3 ${
                          picked
                            ? 'border-primary bg-primary/5'
                            : 'border-line dark:border-line-dk bg-surface dark:bg-surface-dk'
                        } ${full ? 'opacity-50' : 'active:opacity-70'}`}>
                        <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                          {whenLabel(s.starts_at)}
                        </Text>
                        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                          {s.coach_name ? `${s.coach_name} · ` : ''}
                          {full
                            ? 'Full'
                            : `${s.spaces_left} ${
                                s.spaces_left === 1 ? 'spot' : 'spots'
                              } left`}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            ) : null}

            {session ? (
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                You're signed in — claim it and it's yours.
              </Text>
            ) : (
              <View className="gap-4">
                <Input
                  label="Your name"
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Alex Smith"
                  autoCapitalize="words"
                />
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="alex@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
              </View>
            )}

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}

            <Button
              onPress={() => claim.mutate()}
              loading={claim.isPending}
              disabled={
                (needsPick && !pickedSession) ||
                (!session &&
                  (fullName.trim() === '' ||
                    email.trim() === '' ||
                    password.length < 8))
              }>
              Claim my free class
            </Button>

            <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
              We hold your spot while you finish the gym's health screening and
              waiver. No card needed.
            </Text>

            {session ? null : <LegalConsentNotice />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
