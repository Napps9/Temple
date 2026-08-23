import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

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
      className="w-6 h-6 items-center justify-center rounded-full active:bg-raised dark:active:bg-raised-dk">
      <Ionicons
        name={active ? 'information-circle' : 'information-circle-outline'}
        size={18}
        color={active ? colors.primary : colors.ink3}
      />
    </Pressable>
  );
}

function InfoPanel({ what, why }: { what: string; why: string }) {
  return (
    <View className="bg-raised dark:bg-raised-dk/60 rounded-ctl p-3 gap-2">
      <View className="gap-0.5">
        <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-semibold uppercase tracking-wider">
          What this shows
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-5">
          {what}
        </Text>
      </View>
      <View className="gap-0.5">
        <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-semibold uppercase tracking-wider">
          Why it matters
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-5">
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
                ? 'text-ink dark:text-ink-dk text-lg font-semibold'
                : 'text-ink dark:text-ink-dk font-semibold'
            }>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs mt-0.5">
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
