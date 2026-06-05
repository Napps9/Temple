import { Link } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

type Tone = 'default' | 'green' | 'red' | 'muted';
type LinkHref = ComponentProps<typeof Link>['href'];

const valueToneClass: Record<Tone, string> = {
  default: 'text-gray-900 dark:text-gray-50',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
};

type Props = {
  title: string;
  value: string | number;
  subtitle?: string;
  tone?: Tone;
  href?: LinkHref;
  minWidth?: number;
};

export function StatTile({
  title,
  value,
  subtitle,
  tone = 'default',
  href,
  minWidth = 150,
}: Props) {
  const content: ReactNode = (
    <>
      <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
        {title}
      </Text>
      <Text className={`${valueToneClass[tone]} text-3xl font-semibold`}>
        {value}
      </Text>
      {subtitle ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{subtitle}</Text>
      ) : null}
    </>
  );

  const className = 'bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 flex-1';
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
