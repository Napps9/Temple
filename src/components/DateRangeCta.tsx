import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/theme';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Sheet } from '@/components/Sheet';

export type Preset = 'month' | 'quarter' | 'year' | '7d' | '30d' | 'custom';

export const PRESET_LABELS: Record<Exclude<Preset, 'custom'>, string> = {
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function presetRange(
  preset: Exclude<Preset, 'custom'>,
  today: Date,
): { start: string; end: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (preset === 'month') {
    return {
      start: isoDate(new Date(Date.UTC(y, m, 1))),
      end: isoDate(new Date(Date.UTC(y, m + 1, 0))),
    };
  }
  if (preset === 'quarter') {
    const q = Math.floor(m / 3);
    return {
      start: isoDate(new Date(Date.UTC(y, q * 3, 1))),
      end: isoDate(new Date(Date.UTC(y, q * 3 + 3, 0))),
    };
  }
  if (preset === 'year') {
    return {
      start: isoDate(new Date(Date.UTC(y, 0, 1))),
      end: isoDate(new Date(Date.UTC(y, 11, 31))),
    };
  }
  const days = preset === '7d' ? 7 : 30;
  const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: isoDate(start), end: isoDate(today) };
}

// Single CTA + modal that owns the date-range picker. Collapses the
// six preset chips + custom inputs into one tappable label that
// expands on demand. Used by the manage dashboard and the insights
// screen — anywhere we need the same "pick a date window" affordance.
export function DateRangeCta({
  preset,
  range,
  customStart,
  customEnd,
  onChange,
}: {
  preset: Preset;
  range: { start: string; end: string };
  customStart: string;
  customEnd: string;
  onChange: (
    next:
      | { preset: Exclude<Preset, 'custom'> }
      | { preset: 'custom'; start: string; end: string },
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  // Local working state while the modal is open — only committed on
  // Apply (custom) or on preset tap (presets). Keeps consumer queries
  // from re-firing on every keystroke in the date fields.
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);
  const [showCustom, setShowCustom] = useState(preset === 'custom');

  function openModal() {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setShowCustom(preset === 'custom');
    setOpen(true);
  }

  const label =
    preset === 'custom'
      ? `${fmtDdmm(range.start)} – ${fmtDdmm(range.end)}`
      : PRESET_LABELS[preset];

  return (
    <View>
      <Pressable
        onPress={openModal}
        className="flex-row items-center justify-between bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full px-4 py-2.5 active:bg-raised dark:active:bg-raised-dk">
        <Text className="text-ink dark:text-ink-dk font-medium">{label}</Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Change</Text>
      </Pressable>

      <Sheet visible={open} title="Select period" onClose={() => setOpen(false)}>
        <View className="gap-3 pb-1">
            <View className="gap-1">
              {(Object.keys(PRESET_LABELS) as Exclude<Preset, 'custom'>[]).map((p) => (
                <PresetOption
                  key={p}
                  label={PRESET_LABELS[p]}
                  active={preset === p && !showCustom}
                  onPress={() => {
                    onChange({ preset: p });
                    setOpen(false);
                  }}
                />
              ))}
              <PresetOption
                label="Custom range"
                active={showCustom}
                onPress={() => setShowCustom(true)}
              />
            </View>

            {showCustom ? (
              <View className="gap-3 pt-2 border-t border-line dark:border-line-dk">
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <DatePicker
                      label="From"
                      value={draftStart}
                      onChange={setDraftStart}
                    />
                  </View>
                  <View className="flex-1">
                    <DatePicker
                      label="To"
                      value={draftEnd}
                      onChange={setDraftEnd}
                    />
                  </View>
                </View>
                <Button
                  onPress={() => {
                    onChange({
                      preset: 'custom',
                      start: draftStart,
                      end: draftEnd,
                    });
                    setOpen(false);
                  }}>
                  Apply custom range
                </Button>
              </View>
            ) : null}
        </View>
      </Sheet>
    </View>
  );
}

function PresetOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between px-3 py-3 rounded-ctl ${
        active ? 'bg-raised dark:bg-raised-dk' : 'active:bg-raised dark:active:bg-raised-dk'
      }`}>
      <Text
        className={
          active
            ? 'text-ink dark:text-ink-dk font-semibold'
            : 'text-ink dark:text-ink-dk'
        }>
        {label}
      </Text>
      {active ? (
        <Ionicons name="checkmark" size={15} color={colors.ink} />
      ) : null}
    </Pressable>
  );
}

// DD/MM for the CTA label on custom ranges. Year omitted on purpose
// — the CTA is short and the explicit range is one tap away in the
// modal if the operator needs to verify.
function fmtDdmm(iso: string): string {
  if (!DATE_RE.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
