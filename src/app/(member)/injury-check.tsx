import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { injuryTitle } from '@/lib/injuries';
import { useThemeColors } from '@/lib/theme';
import { useMyInjuries } from '@/lib/useInjuries';
import { useSetOnboardingFlag } from '@/lib/useOnboardingFlags';

// Guided "do you have any injuries?" step. Reached at the end of the
// PAR-Q on first sign-up and from the Book onboarding checklist. It's a
// softer front door than dropping a new member straight onto the body-map
// logger: answer no and we mark the step done locally; answer yes and we
// hand off to the full injury tracker. Existing injuries short-circuit
// straight to the manage view.

export default function InjuryCheck() {
  const colors = useThemeColors();
  const injuries = useMyInjuries();
  const setFlag = useSetOnboardingFlag();

  const open = (injuries.data ?? []).filter((r) => r.status !== 'resolved');

  async function answerNone() {
    await setFlag('injury_answered');
    router.replace('/book' as never);
  }

  async function addOne() {
    await setFlag('injury_answered');
    router.push('/track/injuries' as never);
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 px-4 md:max-w-xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/book" />

        <View className="items-center gap-3 pt-2">
          <View className="w-16 h-16 rounded-full bg-primary/15 items-center justify-center">
            <Ionicons name="medkit-outline" size={30} color={colors.primary} />
          </View>
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold text-center">
            Any injuries or niggles?
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            Tell your coaches what to work around and they can scale movements
            for you before class. It stays private to you and the coaching team,
            and you can update it any time.
          </Text>
        </View>

        {open.length > 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              You're already tracking {open.length}
            </Text>
            <View className="gap-1.5">
              {open.map((r) => (
                <View key={r.id} className="flex-row items-center gap-2">
                  <View className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <Text
                    className="text-gray-700 dark:text-gray-200 text-sm"
                    numberOfLines={1}>
                    {injuryTitle(r.body_region, r.side)}
                  </Text>
                </View>
              ))}
            </View>
            <Button onPress={addOne}>Add or update an injury</Button>
            <Button variant="secondary" onPress={answerNone}>
              That's everything
            </Button>
          </View>
        ) : (
          <View className="gap-3">
            <Button onPress={addOne}>Yes, add an injury</Button>
            <Button variant="secondary" onPress={answerNone}>
              No injuries right now
            </Button>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
