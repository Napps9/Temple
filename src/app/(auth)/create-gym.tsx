import { useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { BrandPreview } from '@/components/BrandPreview';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import {
  createGymWithSignup,
  refreshMembership,
  resendConfirmation,
  useSession,
} from '@/lib/auth';
import { DEFAULT_BRAND, normaliseHex, slugify } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Step = 'account' | 'gym' | 'check_email' | 'brand';

export default function CreateGymScreen() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(session ? 'gym' : 'account');

  // Account
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  // Gym
  const [gymName, setGymName] = useState('');
  const [gymSlug, setGymSlug] = useState('');
  const slugTouched = useMemo(() => gymSlug !== '' && gymSlug !== slugify(gymName), [gymName, gymSlug]);
  const effectiveSlug = slugTouched ? gymSlug : slugify(gymName);

  // Branding
  const [primary, setPrimary] = useState<string>(DEFAULT_BRAND.primaryColor);
  const [secondary, setSecondary] = useState<string>(DEFAULT_BRAND.secondaryColor);
  const [textColor, setTextColor] = useState<string>(DEFAULT_BRAND.textColor);

  // Save state
  const [createdGymId, setCreatedGymId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email-confirmation recovery state
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  async function submitAccountAndGym() {
    setError(null);
    if (!session) {
      if (!email.trim() || !password) {
        setError('Email and password are required');
        return;
      }
      if (!fullName.trim()) {
        setError('Your name is required');
        return;
      }
    }
    if (!gymName.trim()) {
      setError('Gym name is required');
      return;
    }
    if (!effectiveSlug) {
      setError('Slug must contain at least one letter or digit');
      return;
    }
    setLoading(true);
    try {
      if (session) {
        // Already signed in (came here from /welcome). Just create the
        // gym; the create_gym RPC makes the caller the owner.
        const { data, error: rpcError } = await supabase.rpc('create_gym', {
          p_name: gymName.trim(),
          p_slug: effectiveSlug,
        });
        if (rpcError) throw rpcError;
        setCreatedGymId(data as unknown as string);
        await refreshMembership(queryClient);
        setStep('brand');
      } else {
        const result = await createGymWithSignup({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          gymName: gymName.trim(),
          gymSlug: effectiveSlug,
        });
        if (result.status === 'pending_confirmation') {
          setPendingEmail(result.email);
          setResendNotice(null);
          setStep('check_email');
        } else {
          setCreatedGymId(result.gymId);
          await refreshMembership(queryClient);
          setStep('brand');
        }
      }
    } catch (e) {
      setError(errorMessage(e, 'Could not create the gym'));
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

  function startOver() {
    setPendingEmail(null);
    setResendNotice(null);
    setError(null);
    setEmail('');
    setPassword('');
    setStep('account');
  }

  async function saveBrandAndFinish() {
    if (!createdGymId) return;
    setError(null);
    const p = normaliseHex(primary);
    const s = normaliseHex(secondary);
    const t = normaliseHex(textColor);
    if (!p || !s || !t) {
      setError('Each colour needs to be a valid 6-character hex (e.g. #2563EB)');
      return;
    }
    setLoading(true);
    try {
      const { error: rpcError } = await supabase.rpc('set_gym_branding', {
        p_gym_id: createdGymId,
        p_logo_url: null,
        p_primary_color: p,
        p_secondary_color: s,
        p_text_color: t,
      });
      if (rpcError) throw rpcError;
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      router.replace('/' as never);
    } catch (e) {
      setError(errorMessage(e, 'Could not save branding'));
    } finally {
      setLoading(false);
    }
  }

  function skipBrand() {
    router.replace('/' as never);
  }

  const validPrimary = normaliseHex(primary) ?? DEFAULT_BRAND.primaryColor;
  const validSecondary = normaliseHex(secondary) ?? DEFAULT_BRAND.secondaryColor;
  const validText = normaliseHex(textColor) ?? DEFAULT_BRAND.textColor;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView contentContainerClassName="py-8 px-4">
          <View className="gap-6 w-full max-w-lg mx-auto">
            <View className="gap-2">
              <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
                Start a new gym
              </Text>
              <Text className="text-gray-500 dark:text-gray-400">
                {step === 'brand'
                  ? 'Pick your colours. You can refine these in settings later.'
                  : step === 'check_email'
                    ? "Confirm your email so we can keep your gym safe."
                    : 'Tell us about you and the gym you run.'}
              </Text>
            </View>

            <Steps current={step} />

            {step === 'check_email' && pendingEmail ? (
              <View className="gap-4 bg-white dark:bg-gray-900 rounded-2xl p-5">
                <View className="gap-2">
                  <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                    Check your email
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400">
                    We sent a confirmation link to{' '}
                    <Text className="text-gray-900 dark:text-gray-50 font-medium">
                      {pendingEmail}
                    </Text>
                    . Click it, then come back here and sign in — we've saved your
                    gym details so you won't have to type them again.
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
                <Button
                  variant="secondary"
                  onPress={resend}
                  loading={resendLoading}>
                  Resend confirmation email
                </Button>
                <Pressable onPress={startOver} className="self-center">
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Use a different email
                  </Text>
                </Pressable>
                <View className="items-center pt-1">
                  <Link href="/sign-in" asChild>
                    <Pressable hitSlop={8}>
                      <Text className="text-primary text-sm">
                        Already confirmed? Sign in
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              </View>
            ) : null}

            {step !== 'brand' && step !== 'check_email' ? (
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
                ) : null}
                <Input
                  label="Gym name"
                  value={gymName}
                  onChangeText={setGymName}
                  autoCapitalize="words"
                  placeholder="Iron Temple"
                />
                <Input
                  label="Slug (used in your join link)"
                  value={slugTouched ? gymSlug : slugify(gymName)}
                  onChangeText={(v) => setGymSlug(slugify(v))}
                  autoCapitalize="none"
                  placeholder="iron-temple"
                />
                {effectiveSlug ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    Members will join at{' '}
                    <Text className="font-mono">/join/{effectiveSlug}</Text>
                  </Text>
                ) : null}

                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
                ) : null}
                <Button onPress={submitAccountAndGym} loading={loading}>
                  {session ? 'Create gym' : 'Create account and gym'}
                </Button>
              </View>
            ) : (
              <View className="gap-4">
                <BrandPreview
                  gymName={gymName}
                  logoUrl={null}
                  primaryColor={validPrimary}
                  secondaryColor={validSecondary}
                  textColor={validText}
                />
                <Input
                  label="Primary colour"
                  value={primary}
                  onChangeText={setPrimary}
                  autoCapitalize="characters"
                  placeholder="#2563EB"
                />
                <Input
                  label="Secondary colour"
                  value={secondary}
                  onChangeText={setSecondary}
                  autoCapitalize="characters"
                  placeholder="#0F172A"
                />
                <Input
                  label="Text colour"
                  value={textColor}
                  onChangeText={setTextColor}
                  autoCapitalize="characters"
                  placeholder="#0F172A"
                />
                {error ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
                ) : null}
                <Button onPress={saveBrandAndFinish} loading={loading}>
                  Save and finish
                </Button>
                <Pressable onPress={skipBrand} className="self-center">
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Skip — I'll set this up later
                  </Text>
                </Pressable>
              </View>
            )}

            <View className="items-center pt-2">
              <Link href="/sign-in" asChild>
                <Pressable hitSlop={8}>
                  <Text className="text-primary">
                    Have an account? Sign in
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

function Steps({ current }: { current: Step }) {
  const labels: { key: Step; label: string }[] = [
    { key: 'account', label: 'Account' },
    { key: 'gym', label: 'Gym' },
    { key: 'brand', label: 'Brand' },
  ];
  // 'check_email' sits between 'gym' and 'brand' — for the bar it
  // counts as "gym done, brand pending" so the user can see they're
  // most of the way through.
  const passes: Record<Step, number> = {
    account: 0,
    gym: 1,
    check_email: 2,
    brand: 2,
  };
  const progress = passes[current] ?? 0;
  return (
    <View className="flex-row gap-2">
      {labels.map((_, i) => (
        <View
          key={i}
          className={`flex-1 h-1.5 rounded-full ${
            i <= progress ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        />
      ))}
    </View>
  );
}
