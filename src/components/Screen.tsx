import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

const DEFAULT_EDGES: readonly Edge[] = ['top', 'left', 'right'];

export function Screen({
  children,
  className,
  edges = DEFAULT_EDGES,
}: {
  children: ReactNode;
  className?: string;
  edges?: readonly Edge[];
}) {
  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950" edges={edges}>
      <View className={`flex-1 px-6 ${className ?? ''}`}>{children}</View>
    </SafeAreaView>
  );
}
