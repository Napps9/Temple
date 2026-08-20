import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

type Tone = 'default' | 'green' | 'red' | 'muted';
type LinkHref = ComponentProps<typeof Link>['href'];

export type DeltaDirection = 'up' | 'down' | 'flat';
export type Delta = {
  direction: DeltaDirection;
  label: string;
};

const valueToneClass: Record<Tone, string> = {
  default: 'text-gray-900 dark:text-gray-50',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
};

const deltaIcon: Record<DeltaDirection, ComponentProps<typeof Ionicons>['name']> = {
  up: 'trending-up',
  down: 'trending-down',
  flat: 'remove',
};

const deltaClass: Record<DeltaDirection, string> = {
  up: 'text-green-600 dark:text-green-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-gray-500 dark:text-gray-400',
};

const deltaColor: Record<DeltaDirection, string> = {
  up: '#16A34A',
  down: '#DC2626',
  flat: '#6B7280',
};

type Props = {
  title: string;
  value: string | number;
  subtitle?: string;
  delta?: Delta;
  tone?: Tone;
  href?: LinkHref;
  minWidth?: number;
};

export function StatTile({
  title,
  value,
  subtitle,
  delta,
  tone = 'default',
  href,
  minWidth = 150,
}: Props) {
  const content: ReactNode = (
    <>
      {/* One line each, both of them. `tracking-widest` on an uppercase
          label inside a 100px tile broke "RECIPIENTS" across two lines
          mid-word, and a three-character value like "100%" dropped its
          percent sign onto a second row. Shrinking to fit is right for a
          label and wrong for a number, so only the label may scale. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-wider">
        {title}
      </Text>
      <Text
        numberOfLines={1}
        className={`${valueToneClass[tone]} text-3xl font-semibold`}>
        {value}
      </Text>
      {delta ? (
        <View className="flex-row items-center gap-1">
          <Ionicons
            name={deltaIcon[delta.direction]}
            size={12}
            color={deltaColor[delta.direction]}
          />
          <Text className={`${deltaClass[delta.direction]} text-xs`}>
            {delta.label}
          </Text>
        </View>
      ) : null}
      {subtitle ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{subtitle}</Text>
      ) : null}
    </>
  );

  const className = 'bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 flex-1 shadow-card';
  const style = { minWidth };

  if (href) {
    return (
      <Link href={href} asChild>
        <Pressable className={className} style={style}>
          {content}
        </Pressable>
      </Link>
    );
  }
  return (
    <View className={className} style={style}>
      {content}
    </View>
  );
}
