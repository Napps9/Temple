import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { starterDocument } from '@/lib/email/blocks';
import { DEFAULT_AUDIENCE } from '@/lib/email/audience';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

// Creates a fresh draft seeded with an on-brand starter layout, then
// hands straight off to the editor. A dedicated route (rather than a
// button that both creates and navigates) keeps the create idempotent
// across a back-navigation.
export default function NewCampaign() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!membership?.gymId || !session?.user.id) return;
    ran.current = true;
    (async () => {
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
      if (insErr || !data) {
        setError(errorMessage(insErr, 'Could not create the campaign'));
        ran.current = false;
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['comms-campaigns'] });
      router.replace(`/management/communications/${data.id}`);
    })();
  }, [membership?.gymId, session?.user.id, brand]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="py-6 px-4 gap-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Email campaigns" fallbackHref="/management/communications" />
        {error ? (
          <Text className="text-red-500 dark:text-red-400">{error}</Text>
        ) : (
          <View className="items-center py-12 gap-3">
            <ActivityIndicator />
            <Text className="text-gray-500 dark:text-gray-400">Creating your campaign…</Text>
          </View>
        )}
      </View>
    </Screen>
  );
}
