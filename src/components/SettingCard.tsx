import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/Button';

// One decision, one card, its own save. The rule this enforces is already
// in the house style and is worth restating because it is the thing most
// often got wrong: there is never a page-level "Save changes" spanning
// several cards, because a member cannot tell which of their edits it is
// about to commit.
//
// `control` sits beside the title when it is small (a switch, a segmented
// control) and underneath when it is not (`wide`, for a text field or a
// colour picker).
//
// A card with no `onSave` is a card whose control saves on toggle — a lone
// switch — and it correctly renders no button at all.
export function SettingCard({
  title,
  description,
  control,
  wide,
  onSave,
  saving,
  saved,
  error,
  saveLabel = 'Save',
}: {
  title: string;
  description?: string;
  control?: ReactNode;
  wide?: boolean;
  onSave?: () => void;
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  saveLabel?: string;
}) {
  return (
    <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-ink dark:text-ink-dk text-[15.5px] font-semibold tracking-[-0.2px]">
            {title}
          </Text>
          {description ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] leading-[17px]">
              {description}
            </Text>
          ) : null}
        </View>
        {wide ? null : control}
      </View>

      {wide && control ? <View className="mt-3">{control}</View> : null}

      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-red-600 dark:text-red-400 text-xs mt-3">
          {error}
        </Text>
      ) : null}

      {onSave ? (
        <View className="flex-row justify-end mt-3.5">
          <Button onPress={onSave} loading={saving} success={saved}>
            {saveLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
