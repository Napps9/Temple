import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { useGymMembership, useSession } from '@/lib/auth';
import { DEFAULT_AUTOMATION_WAIT_DAYS } from '@/lib/email/automation-knob';
import { renderEmailHtml, renderEmailText } from '@/lib/email/render';
import { FALLBACK_BRAND_SEED, starterDocument } from '@/lib/email/blocks';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

type TriggerType =
  | 'member_joined'
  | 'member_first_class'
  | 'member_inactive'
  | 'lead_cold'
  | 'member_tagged';

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
  member_tagged: 'When a member is tagged',
};

// The automations list, as a section of the Communications directory
// rather than a screen of its own. It was one: a Screen, a BackLink and a
// PageHead around this list, reached by a card on the directory — a whole
// page whose body is four rows and a switch each.
export function AutomationList() {
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
          primaryColor: FALLBACK_BRAND_SEED.primaryColor,
          secondaryColor: FALLBACK_BRAND_SEED.secondaryColor,
          textColor: FALLBACK_BRAND_SEED.textColor,
        },
        { gymName: brand.gymName, },
      );
      const { data, error: e } = await supabase
        .from('email_automations')
        .insert({
          gym_id: membership!.gymId,
          created_by: session!.user.id,
          name: 'Untitled automation',
          subject: `A note from ${brand.gymName}`,
          // The default wait lives here, in the stored row, rather than
          // being faked on read — otherwise a real 0 can't be told from a
          // fresh default (both are delay_minutes 0). See automation-knob.ts.
          delay_minutes: DEFAULT_AUTOMATION_WAIT_DAYS * 1440,
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

  if (canManageComms !== true) return null;

  return (
    <View className="gap-2">
      <SectionLabel
        right={
          <Button
            variant="secondary"
            onPress={() => create.mutate()}
            loading={create.isPending}>
            New
          </Button>
        }>
        Automations
      </SectionLabel>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      {automations.isLoading ? (
        <EmptyState kind="loading" rows={2} />
      ) : (automations.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="flash-outline"
          title="No automations yet"
          description="Emails that send themselves when something happens — a member joins, attends their first class, goes quiet, or a lead stays cold."
          actionLabel="Set one up"
          onAction={() => create.mutate()}
        />
      ) : (
        <View className="gap-2">
          {automations.data!.map((a) => (
            <View
              key={a.id}
              className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 flex-row items-center gap-3">
              <Link href={`/management/communications/automations/${a.id}`} asChild>
                <Pressable className="flex-1 active:opacity-70">
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {a.name}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
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
    </View>
  );
}
