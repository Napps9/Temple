import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { CustomDomainCard } from '@/components/website/CustomDomainCard';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymWebsite } from '@/lib/use-gym-website';

// Only reachable once a site exists — a domain is meaningless before
// there's anything to serve. Uses the same ['gym-website'] query the
// editor screen reads and writes, so creating a site there is
// immediately visible here (a separate existence query previously held
// a stale "no site" answer and bounced users straight back).
export default function WebsiteDomainScreen() {
  const canManageWebsite = useCan('can_manage_website');
  const brand = useGymBrand();
  const site = useGymWebsite(brand.gymId);

  if (canManageWebsite === false) return <Redirect href="/management" />;

  if (site.isLoading) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (site.data === null) return <Redirect href="/management/website" />;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/website" />
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
