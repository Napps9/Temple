import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { SignaturePad, type SignatureValue } from '@/components/SignaturePad';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
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
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['waiver-state'] });
      queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
      // Back through the entry gate so any remaining step (e.g. PAR-Q,
      // when the gym runs both) is picked up before /book.
      router.replace('/' as never);
    },
    onError: (e) => setError(errorMessage(e, 'Could not submit your signature')),
  });

  if (active.isLoading) {
    return (
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 p-6">Loading…</Text>
      </Screen>
    );
  }

  if (!active.data) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-xl md:mx-auto md:w-full px-4">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            No waiver yet
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
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
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            {active.data.title}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Please read the waiver in full, then sign below to confirm you
            agree. You'll need to do this before booking a class.
          </Text>
        </View>

        <Pressable
          onPress={() => openUrl(active.data!.file_url)}
          className="flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-xl p-4 active:opacity-70 border border-gray-200 dark:border-gray-800">
          <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center">
            <Ionicons name="document-text-outline" size={20} color="#2563EB" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Read the waiver (PDF)
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Opens the full document — v{active.data.version}
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color="#9CA3AF" />
        </Pressable>

        <View className="gap-2">
          <Text className="text-gray-700 dark:text-gray-200 font-medium">
            Your signature
          </Text>
          <SignaturePad onChange={setSignature} />
        </View>

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          className="flex-row items-start gap-3 active:opacity-70">
          <View
            className={`w-6 h-6 rounded-md border-2 items-center justify-center mt-0.5 ${
              agreed
                ? 'bg-primary border-primary'
                : 'border-gray-300 dark:border-gray-600'
            }`}>
            {agreed ? (
              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            ) : null}
          </View>
          <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm">
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
