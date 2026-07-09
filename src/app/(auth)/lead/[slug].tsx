import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
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
  public_lead_capture_enabled: boolean;
};

export default function LeadCaptureScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

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
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      if (!slug) throw new Error('Missing link');
      if (!fullName.trim()) throw new Error('Your name is required');
      if (!email.trim() && !phone.trim()) {
        throw new Error('Leave an email or a phone number so they can reach you');
      }
      const { error: e } = await supabase.rpc('capture_public_lead', {
        p_slug: slug,
        p_full_name: fullName.trim(),
        p_email: email.trim(),
        p_phone: phone.trim() || null,
        p_message: message.trim() || null,
        p_marketing_consent: marketingConsent,
      });
      if (e) throw e;
      // Nudge the notification worker so the assigned coach hears about it
      // straight away. Best-effort — the enquiry is already safely stored.
      if (gym.data?.id) {
        try {
          await supabase.functions.invoke('send-lead-notifications', {
            body: { gym_id: gym.data.id },
          });
        } catch {
          // Non-fatal: the coach's email stays queued for retry.
        }
      }
    },
    onSuccess: () => {
      setError(null);
      setDone(true);
    },
    onError: (e) => setError(errorMessage(e, 'Could not send your enquiry')),
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
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Gym not found
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            Double-check the link from your gym.
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

  if (!info.public_lead_capture_enabled) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <GymLogo size={64} logoUrl={info.logo_url} name={info.name} primaryColor={primary} />
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            {info.name}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            This gym isn't taking enquiries through this link right now.
          </Text>
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <GymLogo size={64} logoUrl={info.logo_url} name={info.name} primaryColor={primary} />
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold text-center">
            Thanks, {fullName.trim().split(' ')[0] || 'there'}!
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            {info.name} has your details and will be in touch soon.
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
              <GymLogo size={64} logoUrl={info.logo_url} name={info.name} primaryColor={primary} />
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                Enquire at
              </Text>
              <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold text-center">
                {info.name}
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-center text-sm">
                Leave your details and the team will get back to you.
              </Text>
            </View>

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
                label="Phone (optional)"
                value={phone}
                onChangeText={setPhone}
                placeholder="07700 900000"
                autoCapitalize="none"
                keyboardType="phone-pad"
              />
              <Input
                label="Message (optional)"
                value={message}
                onChangeText={setMessage}
                placeholder="What are you looking for?"
                multiline
              />

              <Pressable
                onPress={() => setMarketingConsent((v) => !v)}
                className="flex-row items-start gap-3 active:opacity-70">
                <View
                  className={`w-5 h-5 rounded border items-center justify-center mt-0.5 ${
                    marketingConsent
                      ? 'bg-primary border-primary'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                  {marketingConsent ? (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  ) : null}
                </View>
                <Text className="flex-1 text-gray-500 dark:text-gray-400 text-xs leading-5">
                  I'm happy for {info.name} to email or text me about
                  membership, offers and classes. You can unsubscribe at any
                  time. We'll always handle your details in line with our
                  privacy policy.
                </Text>
              </Pressable>

              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
              ) : null}

              <Button
                onPress={() => submit.mutate()}
                loading={submit.isPending}
                disabled={fullName.trim() === ''}>
                Send enquiry
              </Button>

              <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
                Already a member?{' '}
                <Link href="/sign-in" asChild>
                  <Text className="text-primary">Sign in</Text>
                </Link>
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
