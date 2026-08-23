import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { LegalConsentNotice } from '@/components/LegalConsentNotice';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { TempleLockup, TempleMark } from '@/components/TempleMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  acceptInvite,
  joinGymByInvite,
  refreshMembership,
  resendConfirmation,
  useSession,
} from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { GymRole } from '@/types/database';

// The inviting gym, resolved from the emailed code so the invitee sees
// whose gym they're joining — same welcome as the public /join/[slug]
// screen, but keyed by the single-use invite code.
type InviteGym = {
  gym_id: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  text_color: string;
  logo_url_dark: string | null;
  primary_color_dark: string | null;
  role: GymRole;
};

const ROLE_LABEL: Record<GymRole, string> = {
  owner: 'an owner',
  admin: 'an admin',
  coach: 'a coach',
  staff: 'staff',
  member: 'a member',
};

export default function AcceptInviteScreen() {
  // Invites arrive only as an emailed link carrying the single-use code,
  // so the code is read from the URL — there's no manual code entry.
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (params.code ?? '').trim();
  const session = useSession();
  const queryClient = useQueryClient();

  const gym = useQuery({
    queryKey: ['invite-gym', code],
    enabled: !!code,
    queryFn: async (): Promise<InviteGym | null> => {
      const { data, error } = await supabase.rpc('invite_code_gym', {
        p_code: code,
      });
      if (error) throw error;
      const rows = (data ?? []) as InviteGym[];
      return rows[0] ?? null;
    },
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const realInfo = gym.data ?? null;
  // Definitively invalid only when the display lookup SUCCEEDED and found
  // nothing (used / expired / bad code). If the lookup errors, we don't
  // block — the invite still binds through accept_invite, so we fall back
  // to neutral Temple branding and let them sign up anyway.
  const invalidCode =
    !!code && !gym.isLoading && !gym.isError && realInfo === null;
  const info: InviteGym = realInfo ?? {
    gym_id: '',
    name: 'your gym',
    logo_url: null,
    primary_color: '#3B6BA5',
    secondary_color: '#3B6BA5',
    text_color: '#111111',
    logo_url_dark: null,
    primary_color_dark: null,
    role: 'member',
  };
  const branded = !!realInfo;
  const primary = info.primary_color;

  const signUpAndAccept = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      if (!trimmedName) throw new Error('Enter your full name');
      if (!trimmedEmail) throw new Error('Enter your email');
      if (!password) throw new Error('Enter a password');
      return acceptInvite(code, trimmedEmail, password, trimmedName);
    },
    onSuccess: async (result) => {
      setError(null);
      if (result.status === 'pending_confirmation') {
        setPendingEmail(result.email);
        setResendNotice(null);
        return;
      }
      await refreshMembership(queryClient);
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      router.replace('/' as never);
    },
    onError: (e) => setError(errorMessage(e, 'Invite could not be accepted')),
  });

  // Signed in already: one tap binds the membership, no signup.
  const acceptSignedIn = useMutation({
    mutationFn: async () => joinGymByInvite(code),
    onSuccess: async () => {
      setError(null);
      await refreshMembership(queryClient);
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      router.replace('/' as never);
    },
    onError: (e) => setError(errorMessage(e, 'Could not accept the invite')),
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

  return (
    <Screen>
      <View className="absolute top-3 right-3 z-10">
        <ThemeToggle />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center py-8 px-4">
          <View className="gap-6 w-full max-w-md mx-auto">
            {renderBody()}
            <View className="items-center">
              <Link href="/sign-in" asChild>
                <Pressable hitSlop={8}>
                  <Text
                    className="text-sm"
                    style={primary ? { color: primary } : undefined}>
                    Already have an account? Sign in
                  </Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );

  function renderBody() {
    // No code in the link.
    if (!code) {
      return (
        <>
          <Header />
          <View className="gap-2">
            <Text className="text-ink dark:text-ink-dk text-3xl font-semibold">
              Open your invite link
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk">
              Invites are sent by email — open the link your gym emailed you to
              join. If you can't find it, ask them to resend it.
            </Text>
          </View>
        </>
      );
    }

    if (gym.isLoading) {
      return (
        <>
          <Header />
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            Loading your invite…
          </Text>
        </>
      );
    }

    // Code present but not resolvable — used, expired, or bad link.
    if (invalidCode) {
      return (
        <>
          <Header />
          <View className="gap-2">
            <Text className="text-ink dark:text-ink-dk text-3xl font-semibold">
              This invite isn't valid
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk">
              It may have already been used or expired. Ask your gym to send you
              a fresh invite.
            </Text>
          </View>
        </>
      );
    }

    // Confirmation deferred — signed up, waiting on the email link.
    if (pendingEmail) {
      return (
        <>
          {branded ? <GymHeader info={info} /> : <Header />}
          <View className="gap-2">
            <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
              Check your email
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk">
              We sent a confirmation link to{' '}
              <Text className="text-ink dark:text-ink-dk font-medium">
                {pendingEmail}
              </Text>
              . Click it, then come back and sign in — you'll land straight in{' '}
              {info.name}.
            </Text>
          </View>
          {resendNotice ? (
            <Text className="text-emerald-600 dark:text-emerald-400 text-sm">
              {resendNotice}
            </Text>
          ) : null}
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <Button variant="secondary" onPress={resend} loading={resendLoading}>
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
        </>
      );
    }

    // Already signed in — one-tap join.
    if (session) {
      return (
        <>
          {branded ? <GymHeader info={info} /> : <Header />}
          <Text className="text-ink-2 dark:text-ink-2-dk text-center">
            You're signed in — one tap to join {info.name} as{' '}
            {ROLE_LABEL[info.role]}.
          </Text>
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}
          <BrandButton
            color={info.primary_color}
            onPress={() => acceptSignedIn.mutate()}
            loading={acceptSignedIn.isPending}>
            {`Join ${info.name}`}
          </BrandButton>
        </>
      );
    }

    // New account + accept.
    return (
      <>
        <GymHeader info={info} />
        <View className="gap-4">
          <Input
            label="Full name"
            value={name}
            onChangeText={setName}
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
        </View>
        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <BrandButton
          color={info.primary_color}
          onPress={() => signUpAndAccept.mutate()}
          loading={signUpAndAccept.isPending}>
          Create account & join
        </BrandButton>
        <LegalConsentNotice />
      </>
    );
  }
}

// Temple chrome for the no-code / invalid states (no gym to brand with).
function Header() {
  return (
    <View className="items-center">
      <TempleLockup size={22} />
    </View>
  );
}

// Gym-branded header once we know the inviting gym — logo, "You're
// joining" eyebrow, gym name. Mirrors the /join/[slug] welcome.
function GymHeader({ info }: { info: InviteGym }) {
  return (
    <View className="items-center gap-3 pt-2">
      <TempleMark size={56} />
      <FieldLabel>
        You're joining
      </FieldLabel>
      <Text className="text-ink dark:text-ink-dk text-2xl font-semibold text-center">
        {info.name}
      </Text>
    </View>
  );
}

// The primary CTA in the gym's own colour (matches the /join screen). The
// shared <Button> uses the app's default primary; here we want the gym's.
function BrandButton({
  color,
  onPress,
  loading,
  children,
}: {
  color: string;
  onPress: () => void;
  loading?: boolean;
  children: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={{ backgroundColor: color }}
      className="rounded-ctl px-5 py-3 items-center justify-center active:opacity-80 disabled:opacity-60">
      <Text className="text-white font-semibold">
        {loading ? 'Working…' : children}
      </Text>
    </Pressable>
  );
}
