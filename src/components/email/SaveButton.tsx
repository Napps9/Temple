import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable } from 'react-native';
import { Text } from '@/components/Text';

import { useThemeColors } from '@/lib/theme';

// Explicit Save control for the email builder headers: autosave still
// runs, but a visible button plus a "Saved" confirmation removes the
// guesswork about whether edits landed.
export function SaveButton({
  state,
  onPress,
}: {
  state: 'idle' | 'saving' | 'saved';
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const saved = state === 'saved';
  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'saving'}
      hitSlop={6}
      className={`flex-row items-center gap-1.5 rounded-ctl px-3 py-1.5 active:opacity-80 hover:opacity-90 ${
        saved ? 'bg-green-500/10' : 'bg-primary disabled:opacity-70'
      }`}>
      {state === 'saving' ? (
        <ActivityIndicator size="small" color={saved ? '#16A34A' : colors.onPrimary} />
      ) : (
        <Ionicons
          name={saved ? 'checkmark-circle' : 'save-outline'}
          size={15}
          color={saved ? '#16A34A' : colors.onPrimary}
        />
      )}
      <Text
        className={`text-sm font-semibold ${
          saved ? 'text-green-700 dark:text-green-400' : 'text-on-primary'
        }`}>
        {state === 'saving' ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </Text>
    </Pressable>
  );
}
