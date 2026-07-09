import { ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import type { LegalDoc } from '@/lib/legal';

// Renders a public legal document (/terms, /privacy) in the house
// long-form layout. Reachable signed-out, so it opens cold from a shared
// link — BackLink falls back to the index gate, which routes to the right
// home for the visitor's auth state.
export function LegalDocScreen({ doc }: { doc: LegalDoc }) {
  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Back" fallbackHref="/" />

        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
            {doc.title}
          </Text>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Last updated {doc.updated}
          </Text>
        </View>

        <View className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3">
          <Text className="text-amber-700 dark:text-amber-300 text-xs">
            {doc.draftNotice}
          </Text>
        </View>

        {doc.intro.map((p, i) => (
          <Text key={`intro-${i}`} className="text-gray-600 dark:text-gray-300 leading-6">
            {p}
          </Text>
        ))}

        {doc.sections.map((section) => (
          <View key={section.heading} className="gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              {section.heading}
            </Text>
            {section.body.map((p, i) => (
              <Text
                key={`${section.heading}-${i}`}
                className="text-gray-600 dark:text-gray-300 leading-6">
                {p}
              </Text>
            ))}
          </View>
        ))}

        <Text className="text-gray-500 dark:text-gray-400 text-sm pt-2">
          {doc.contact}
        </Text>
      </ScrollView>
    </Screen>
  );
}
