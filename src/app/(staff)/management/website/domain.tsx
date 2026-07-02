import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { CustomDomainCard } from '@/components/website/CustomDomainCard';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';

// Only reachable once a site exists — a domain is meaningless before
// there's anything to serve. Mirrors website.tsx's own entitlement/site
// gating rather than re-deriving it, but this screen only needs to know
// *whether* a site row exists, not its content.
function useSiteExists(gymId: string | null | undefined) {
  return useQuery({
    queryKey: ['gym-website-exists', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gym_websites')
        .select('id')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

export default function WebsiteDomainScreen() {
  const canManageWebsite = useCan('can_manage_website');
  const brand = useGymBrand();
  const siteExists = useSiteExists(brand.gymId);

  if (canManageWebsite === false) return <Redirect href="/management" />;

  if (siteExists.isLoading) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (siteExists.data === false) return <Redirect href="/management/website" />;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Website" fallbackHref="/management/website" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Custom domain
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Serve {brand.gymName}'s site from a domain you own.
          </Text>
        </View>
        <CustomDomainCard gymId={brand.gymId} />
      </ScrollView>
    </Screen>
  );
}
