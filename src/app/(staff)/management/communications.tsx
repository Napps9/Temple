import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { AutomationList } from '@/components/email/AutomationList';
import { CampaignList } from '@/components/email/CampaignList';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { useGymMembership, useSession } from '@/lib/auth';
import { useCampaigns } from '@/lib/comms';
import { DEFAULT_AUDIENCE } from '@/lib/email/audience';
import { starterDocument } from '@/lib/email/blocks';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';
import type { Json } from '@/types/database';

// A new campaign is a row that has to exist before there is anything to
// edit, so creating it is a mutation with a loading state rather than a
// route with a spinner. It used to be /communications/new: a screen whose
// entire job was to insert a row and redirect, which a member saw for
// about a second and could not do anything on.
function useCreateCampaign() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!membership?.gymId || !session?.user.id) throw new Error('No gym');
      const doc = starterDocument(
        {
          primaryColor: brand.primaryColor,
          secondaryColor: brand.secondaryColor,
          textColor: brand.textColor,
        },
        { gymName: brand.gymName, logoUrl: brand.logoUrl },
      );
      const { data, error: insErr } = await supabase
        .from('email_campaigns')
        .insert({
          gym_id: membership.gymId,
          created_by: session.user.id,
          title: 'Untitled campaign',
          design: doc as unknown as Json,
          audience: DEFAULT_AUDIENCE as unknown as Json,
        })
        .select('id')
        .single();
      if (insErr || !data) throw insErr ?? new Error('No id');
      return data.id as string;
    },
    onSuccess: (id) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['comms-campaigns'] });
      router.push(`/management/communications/${id}`);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the campaign')),
  });

  return { create, error };
}

// Reusable overview + lists, also embedded in the Manage → Comms tab.
export function CommunicationsHome({ onNew }: { onNew?: () => void }) {
  const campaigns = useCampaigns();
  const colors = useThemeColors();

  const stats = useMemo(() => {
    const rows = campaigns.data ?? [];
    const sent = rows.filter((r) => r.status === 'sent');
    const reached = sent.reduce((acc, r) => acc + r.recipient_count, 0);
    return { total: rows.length, sent: sent.length, reached };
  }, [campaigns.data]);

  return (
    <View className="gap-5">
      <View className="flex-row gap-3 flex-wrap">
        <StatTile title="Campaigns" value={stats.total} minWidth={100} />
        <StatTile title="Sent" value={stats.sent} minWidth={100} />
        <StatTile title="Emails delivered" value={stats.reached} minWidth={100} />
      </View>

      <CampaignList onNew={onNew} />

      <AutomationList />

      <Link href="/management/communications/settings" asChild>
        <Pressable className="flex-row items-center gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 active:opacity-70">
          <View className="w-9 h-9 rounded-lg bg-raised dark:bg-raised-dk items-center justify-center">
            <Ionicons name="settings-outline" size={18} color={colors.ink2} />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Email settings
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Sender, the required postal-address footer, and the topics
              members can unsubscribe from.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
        </Pressable>
      </Link>
    </View>
  );
}

export default function CommunicationsScreen() {
  const canManageComms = useCan('can_manage_comms');
  const { create, error } = useCreateCampaign();

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" />
        <PageHead
          title="Email"
          subtitle="Campaigns you send, and the ones that send themselves."
          action={
            canManageComms === true ? (
              <Button onPress={() => create.mutate()} loading={create.isPending}>
                New campaign
              </Button>
            ) : undefined
          }
        />
        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        {canManageComms === false ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">
            You don't have permission to manage communications.
          </Text>
        ) : (
          <CommunicationsHome onNew={() => create.mutate()} />
        )}
      </ScrollView>
    </Screen>
  );
}
