import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Sheet } from '@/components/Sheet';
import { useThemeColors } from '@/lib/theme';

// Month grid that a calendar header opens to jump to any date. Shared by
// the Book (ClassesCalendar) and Programming calendars so their date
// navigation behaves identically. Self-contained date helpers keep it
// free of either calendar's internals.

const WEEK_LETTERS_MON = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEK_LETTERS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d: Date, weekStartsOn: 'mon' | 'sun') {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  if (weekStartsOn === 'sun') return addDays(x, -day);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(x, diffToMonday);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthGrid(d: Date, weekStartsOn: 'mon' | 'sun') {
  const gridStart = startOfWeek(startOfMonth(d), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function fmtMonthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function MonthPickerModal({
  visible,
  month,
  selected,
  weekStartsOn,
  onChangeMonth,
  onSelectDay,
  onClose,
}: {
  visible: boolean;
  month: Date;
  selected: Date;
  weekStartsOn: 'mon' | 'sun';
  onChangeMonth: (dir: -1 | 1) => void;
  onSelectDay: (day: Date) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const grid = monthGrid(month, weekStartsOn);
  const weekLetters =
    weekStartsOn === 'sun' ? WEEK_LETTERS_SUN : WEEK_LETTERS_MON;
  const today = new Date();

  return (
    <Sheet visible={visible} title="Jump to a date" onClose={onClose} dialogWidth={400}>
      <View className="gap-2 pb-2">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => onChangeMonth(-1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            className="w-9 h-9 rounded-full border border-line-strong dark:border-line-strong-dk items-center justify-center active:bg-raised dark:active:bg-raised-dk">
            <Text className="text-ink-2 dark:text-ink-2-dk text-lg">‹</Text>
          </Pressable>
          <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">
            {fmtMonthYear(month)}
          </Text>
          <Pressable
            onPress={() => onChangeMonth(1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            className="w-9 h-9 rounded-full border border-line-strong dark:border-line-strong-dk items-center justify-center active:bg-raised dark:active:bg-raised-dk">
            <Text className="text-ink-2 dark:text-ink-2-dk text-lg">›</Text>
          </Pressable>
        </View>

        <View className="flex-row">
          {weekLetters.map((l, i) => (
            <View key={i} className="flex-1 items-center pb-1">
              <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-semibold uppercase">
                {l}
              </Text>
            </View>
          ))}
        </View>

        {Array.from({ length: 6 }, (_, w) => (
          <View key={w} className="flex-row">
            {grid.slice(w * 7, (w + 1) * 7).map((d) => {
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = isSameDay(d, today);
              const isSelected = isSameDay(d, selected);
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => onSelectDay(d)}
                  className="flex-1 items-center py-0.5">
                  <View
                    style={isSelected ? { backgroundColor: colors.primary } : undefined}
                    className={`w-9 h-9 rounded-full items-center justify-center ${
                      !isSelected && isToday ? 'border border-primary' : ''
                    }`}>
                    <Text
                      className={`text-[14px] ${
                        isSelected
                          ? 'text-white font-bold'
                          : isToday
                            ? 'text-ink dark:text-ink-dk font-bold'
                            : inMonth
                              ? 'text-ink dark:text-ink-dk'
                              : 'text-ink-3/50 dark:text-ink-3-dk/50'
                      }`}>
                      {d.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}
