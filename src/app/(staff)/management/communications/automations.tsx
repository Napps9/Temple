import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { renderEmailHtml, renderEmailText } from '@/lib/email/render';
import { starterDocument } from '@/lib/email/blocks';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

type TriggerType =
  | 'member_joined'
  | 'member_first_class'
  | 'member_inactive'
  | 'lead_cold';

type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  compiled_html: string | null;
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  member_joined: 'When a member joins',
  member_first_class: 'After a member’s first class',
  member_inactive: 'When a member goes quiet',
  lead_cold: 'When a lead stays cold',
};

export default function AutomationsScreen() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const canManageComms = useCan('can_manage_comms');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const automations = useQuery({
    queryKey: ['email-automations', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<AutomationRow[]> => {
      const { data, error: e } = await supabase
        .from('email_automations')
        .select('id, name, enabled, trigger_type, compiled_html')
        .eq('gym_id', membership!.gymId)
        .order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as AutomationRow[];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error: e } = await supabase
        .from('email_automations')
        .update({ enabled })
        .eq('id', id);
      if (e) throw e;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['email-automations', membership?.gymId] }),
    onError: (e) => setError(errorMessage(e, 'Could not update the automation')),
  });

  const create = useMutation({
    mutationFn: async () => {
      const doc = starterDocument(
        {
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
          textColor: brand.textColor,
        },
        { gymName: brand.gymName, logoUrl: brand.logoUrl },
      );
      const { data, error: e } = await supabase
        .from('email_automations')
        .insert({
          gym_id: membership!.gymId,
          created_by: session!.user.id,
          name: 'Untitled automation',
          subject: `A note from ${brand.gymName}`,
          design: doc as unknown as Json,
          compiled_html: renderEmailHtml(doc),
          compiled_text: renderEmailText(doc),
        })
        .select('id')
        .single();
      if (e || !data) throw e ?? new Error('No id');
      return data.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['email-automations', membership?.gymId] });
      router.push(`/management/communications/automations/${id}`);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the automation')),
  });

  if (canManageComms === false) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="py-6 px-4 gap-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink label="Email" fallbackHref="/management/communications" />
          <Text className="text-gray-500 dark:text-gray-400">
            You don’t have permission to manage communications.
          </Text>
        </View>
      </Screen>
    );
  }
  if (!membership) return null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Email" fallbackHref="/management/communications" />
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Automations
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Emails that send themselves when something happens — a member joins,
              attends their first class, goes quiet, or a lead stays cold.
            </Text>
          </View>
          <Button onPress={() => create.mutate()} loading={create.isPending}>
            New
          </Button>
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {automations.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : (automations.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="flash-outline"
            title="No automations yet"
            description="Tap “New” to set your first one up."
          />
        ) : (
          <View className="gap-2">
            {automations.data!.map((a) => (
              <View
                key={a.id}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center gap-3 shadow-card">
                <Link href={`/management/communications/automations/${a.id}`} asChild>
                  <Pressable className="flex-1 active:opacity-70">
                    <Text className="text-gray-900 dark:text-gray-50 font-medium">
                      {a.name}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">
                      {TRIGGER_LABELS[a.trigger_type]}
                      {a.compiled_html ? '' : ' · draft'}
                    </Text>
                  </Pressable>
                </Link>
                <Switch
                  accessibilityLabel={a.name}
                  value={a.enabled}
                  onValueChange={(v) => toggle.mutate({ id: a.id, enabled: v })}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
