import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { Check } from '@/components/Check';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { SignaturePad, type SignatureValue } from '@/components/SignaturePad';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import type { Json } from '@/types/database';

type ActiveWaiver = {
  id: string;
  version: number;
  title: string;
  file_url: string;
};

function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

export default function WaiverForm() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  // When opened for a dependent (from the Family screen), the guardian signs
  // on the child's behalf and returns there instead of the entry gate.
  const { subject } = useLocalSearchParams<{ subject?: string }>();
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = useQuery({
    queryKey: ['waiver-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ActiveWaiver | null> => {
      const { data, error } = await supabase
        .from('waiver_documents')
        .select('id, version, title, file_url')
        .eq('gym_id', membership!.gymId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data as ActiveWaiver | null;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!membership || !active.data) throw new Error('Missing context');
      if (!signature) throw new Error('Add your signature above');
      if (!agreed) throw new Error('Tick the box to confirm you agree');
      const { error } = await supabase.rpc('sign_waiver', {
        p_gym_id: membership.gymId,
        p_waiver_id: active.data.id,
        p_signature: signature as unknown as Json,
        ...(subject ? { p_subject_profile_id: subject } : {}),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      // Wait for the gate queries to refetch BEFORE navigating. The entry
      // gate (index.tsx) and /family re-check these on mount; the signed
      // state must be in cache first. A fire-and-forget invalidate left
      // the gate reading the stale pre-signature value (needs_waiver:
      // true) and bounced the member straight back to an empty waiver —
      // so the first submit looked like it failed and they had to sign
      // again. refetchType 'all' is required because these queries are
      // unmounted (inactive) while this screen is open, so the default
      // active-only refetch would skip them.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['waiver-state'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['gym-membership'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['dependent-screening'], refetchType: 'all' }),
      ]);
      if (subject) {
        router.replace('/family' as never);
      } else {
        // Back through the entry gate so any remaining step (e.g. PAR-Q,
        // when the gym runs both) is picked up before /book.
        router.replace('/' as never);
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not submit your signature')),
  });

  if (active.isLoading) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk p-6">Loading…</Text>
      </Screen>
    );
  }

  if (!active.data) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            No waiver yet
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Your gym hasn't published a waiver to sign. You can keep using
            the app normally.
          </Text>
          <Button onPress={() => router.replace('/book' as never)}>
            Continue
          </Button>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
        <BackLink />
        <PageHead
          title={active.data.title}
          subtitle="Please read the waiver in full, then sign below to confirm you agree. You'll need to do this before booking a class."
        />

        <Pressable
          onPress={() => openUrl(active.data!.file_url)}
          className="flex-row items-center gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 active:opacity-70">
          <View className="w-10 h-10 rounded-ctl bg-primary/10 items-center justify-center">
            <Ionicons name="document-text-outline" size={20} color={colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-medium">
              Read the waiver (PDF)
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Opens the full document — v{active.data.version}
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color={colors.ink3} />
        </Pressable>

        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk font-medium">
            Your signature
          </Text>
          <SignaturePad onChange={setSignature} />
        </View>

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          className="flex-row items-start gap-3 active:opacity-70">
          <View className="mt-0.5">
            <Check on={agreed} />
          </View>
          <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
            I have read and agree to the waiver, and the signature above is
            mine.
          </Text>
        </Pressable>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={!signature || !agreed}>
          Submit signature
        </Button>
      </ScrollView>
    </Screen>
  );
}
