import { ScrollView, View } from 'react-native';
import { Text } from './Text';

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
        <BackLink fallbackHref="/" />

        <View className="gap-1">
          <Text className="text-ink dark:text-ink-dk text-3xl font-semibold">
            {doc.title}
          </Text>
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Last updated {doc.updated}
          </Text>
        </View>

        {doc.intro.map((p, i) => (
          <Text key={`intro-${i}`} className="text-ink-2 dark:text-ink-2-dk leading-6">
            {p}
          </Text>
        ))}

        {doc.sections.map((section) => (
          <View key={section.heading} className="gap-2">
            <Text className="text-ink dark:text-ink-dk text-lg font-semibold">
              {section.heading}
            </Text>
            {section.body.map((p, i) => (
              <Text
                key={`${section.heading}-${i}`}
                className="text-ink-2 dark:text-ink-2-dk leading-6">
                {p}
              </Text>
            ))}
          </View>
        ))}

        <Text className="text-ink-2 dark:text-ink-2-dk text-sm pt-2">
          {doc.contact}
        </Text>
      </ScrollView>
    </Screen>
  );
}
