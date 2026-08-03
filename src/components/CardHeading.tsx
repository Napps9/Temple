import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Info disclosure — a small (i) toggle that reveals a "what this shows /
// why it matters" panel in the card's white space. Staff see plain
// language explaining the jargon and how to act on each view, without it
// cluttering the default read.
// ---------------------------------------------------------------------------

function InfoButton({
  active,
  onPress,
}: {
  active: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="What this shows"
      className="w-6 h-6 items-center justify-center rounded-full active:bg-gray-100 dark:active:bg-gray-800">
      <Ionicons
        name={active ? 'information-circle' : 'information-circle-outline'}
        size={18}
        color={active ? colors.primary : colors.iconTertiary}
      />
    </Pressable>
  );
}

function InfoPanel({ what, why }: { what: string; why: string }) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 gap-2">
      <View className="gap-0.5">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-semibold uppercase tracking-wider">
          What this shows
        </Text>
        <Text className="text-gray-600 dark:text-gray-300 text-xs leading-5">
          {what}
        </Text>
      </View>
      <View className="gap-0.5">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-semibold uppercase tracking-wider">
          Why it matters
        </Text>
        <Text className="text-gray-600 dark:text-gray-300 text-xs leading-5">
          {why}
        </Text>
      </View>
    </View>
  );
}

// Titled header with an (i) toggle. `size='section'` is the larger
// block heading; the default is a white-card heading. Owns its own
// open state so each card's info is independent.
export function CardHeading({
  title,
  subtitle,
  what,
  why,
  size = 'card',
}: {
  title: string;
  subtitle?: string;
  what: string;
  why: string;
  size?: 'card' | 'section';
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          <Text
            className={
              size === 'section'
                ? 'text-gray-900 dark:text-gray-50 text-lg font-semibold'
                : 'text-gray-900 dark:text-gray-50 font-semibold'
            }>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <InfoButton active={open} onPress={() => setOpen((v) => !v)} />
      </View>
      {open ? <InfoPanel what={what} why={why} /> : null}
    </View>
  );
}
