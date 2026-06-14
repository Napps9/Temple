import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';

// New-visitor landing. The three pathways the product supports —
// member at an existing gym, solo athlete, gym owner — each with
// their own pitch so the visitor's first read is "which of these is
// me?" rather than "what is this?". Order is Join → Solo → Start;
// solo isn't muted because between-gyms athletes are a first-class
// audience, not an afterthought.
export default function GetStartedScreen() {
  return (
    <Screen>
      <ScrollView contentContainerClassName="py-8 px-4">
        <View className="gap-8 w-full max-w-5xl mx-auto">
          <View className="gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-3xl font-semibold">
              Welcome to Temple
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Pick how you'll use it — you can always switch later.
            </Text>
          </View>

          <View className="gap-4 md:flex-row md:gap-6">
            <PathCard
              accent="#10B981"
              icon="people-outline"
              kicker="Member"
              title="Join a gym"
              headline="Show up sharper. Stay in the loop."
              bullets={[
                'Book classes in three taps, see who else is in',
                'Track every workout — weights, PRs, the lot',
                'Hear from your coach without the WhatsApp chaos',
                'Health screening sorted once, not every quarter',
              ]}
              cta="I have an invite"
              href="/accept-invite"
            />
            <PathCard
              accent="#F59E0B"
              icon="flame-outline"
              kicker="Solo"
              title="Train solo"
              headline="Keep the streak. Keep the data. Keep going."
              bullets={[
                'Log workouts and PRs the same way members do',
                '12-week heatmap + workout streak track the work you put in',
                'Free during beta — yours forever',
                'Join a gym later? Your history walks in with you',
              ]}
              cta="Start solo tracking"
              href="/start-solo"
            />
            <PathCard
              accent="#2563EB"
              icon="business-outline"
              kicker="Owner"
              title="Start a gym"
              headline="The whiteboard, the front desk, the books — one app."
              bullets={[
                'Programming, schedules and bookings on one calendar',
                'Members, plans and comms in one place',
                'A public join link the moment you’re ready',
                'Insights that tell you what’s working',
                'Make it look like your gym, not a template',
              ]}
              cta="Get set up"
              href="/create-gym"
            />
          </View>

          <View className="items-center pt-2">
            <Link href="/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Text className="text-primary">
                  Already have an account? Sign in
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function PathCard({
  accent,
  icon,
  kicker,
  title,
  headline,
  bullets,
  cta,
  href,
}: {
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
  kicker: string;
  title: string;
  headline: string;
  bullets: string[];
  cta: string;
  href: string;
}) {
  return (
    <View className="flex-1 bg-white dark:bg-gray-900 rounded-2xl p-5 gap-4 border border-gray-100 dark:border-gray-800">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: `${accent}1A` }}
          className="w-10 h-10 rounded-xl items-center justify-center">
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <View>
          <Text
            style={{ color: accent }}
            className="text-[10px] font-semibold uppercase tracking-widest">
            {kicker}
          </Text>
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            {title}
          </Text>
        </View>
      </View>
      <Text className="text-gray-900 dark:text-gray-50 text-base font-medium">
        {headline}
      </Text>
      <View className="gap-2">
        {bullets.map((b) => (
          <View key={b} className="flex-row gap-2">
            <Ionicons name="checkmark" size={16} color={accent} />
            <Text className="flex-1 text-gray-600 dark:text-gray-300 text-sm">
              {b}
            </Text>
          </View>
        ))}
      </View>
      <Link href={href as never} asChild>
        <Pressable
          style={{ backgroundColor: accent }}
          className="rounded-lg p-3 items-center active:opacity-80 mt-1">
          <Text className="text-white font-semibold">{cta}</Text>
        </Pressable>
      </Link>
    </View>
  );
}
