import { Modal, Pressable, Text, View } from 'react-native';

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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/30 items-center justify-center px-8"
        onPress={onClose}>
        <Pressable
          onPress={() => {}}
          className="w-full max-w-sm md:max-w-md bg-white dark:bg-gray-900 rounded-3xl p-4 gap-3 shadow-pop">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => onChangeMonth(-1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
              <Text className="text-gray-500 dark:text-gray-400 text-lg">‹</Text>
            </Pressable>
            <Text className="text-gray-900 dark:text-gray-50 text-base font-semibold">
              {fmtMonthYear(month)}
            </Text>
            <Pressable
              onPress={() => onChangeMonth(1)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
              <Text className="text-gray-500 dark:text-gray-400 text-lg">›</Text>
            </Pressable>
          </View>

          <View className="flex-row">
            {weekLetters.map((l, i) => (
              <View key={i} className="flex-1 items-center pb-1">
                <Text className="text-gray-400 dark:text-gray-500 text-xs font-medium uppercase">
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
                    className="flex-1 items-center py-1">
                    <View
                      style={isSelected ? { backgroundColor: colors.primary } : undefined}
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        !isSelected && isToday ? 'border border-primary' : ''
                      }`}>
                      <Text
                        className={`text-sm ${
                          isSelected
                            ? 'text-white font-bold'
                            : isToday
                              ? 'text-primary font-bold'
                              : inMonth
                                ? 'text-gray-900 dark:text-gray-50'
                                : 'text-gray-300 dark:text-gray-600'
                        }`}>
                        {d.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
