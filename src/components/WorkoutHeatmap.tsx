import { Text, View } from 'react-native';

import { localDayKey } from '@/lib/workout-streak';

const WEEKS = 12;
const DAY_LETTERS = ['M', '', 'W', '', 'F', '', 'S'];

// A 12-week (84-day) heatmap, drawn from a Set of YYYY-MM-DD keys.
// Days the member logged a workout glow primary-tinted; everything
// else stays a soft neutral. The grid reads left-to-right, oldest
// week first, ending on the column containing `anchor` (today).
export function WorkoutHeatmap({
  loggedDays,
  anchor,
  primaryColor,
}: {
  loggedDays: Set<string>;
  anchor: Date;
  primaryColor: string;
}) {
  // Find the Monday of the week containing `anchor`. Walking back
  // 11 more weeks gives us the grid origin.
  const end = new Date(anchor);
  end.setHours(12, 0, 0, 0);
  const dayOfWeek = (end.getDay() + 6) % 7; // 0 = Mon
  const mondayOfThisWeek = new Date(end);
  mondayOfThisWeek.setDate(end.getDate() - dayOfWeek);
  const origin = new Date(mondayOfThisWeek);
  origin.setDate(mondayOfThisWeek.getDate() - (WEEKS - 1) * 7);

  const columns: Date[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(origin);
      cell.setDate(origin.getDate() + w * 7 + d);
      col.push(cell);
    }
    columns.push(col);
  }

  return (
    <View className="flex-row gap-2">
      <View className="gap-1">
        {DAY_LETTERS.map((l, i) => (
          <View key={i} className="h-4 items-center justify-center">
            <Text className="text-gray-400 dark:text-gray-500 text-[9px]">
              {l}
            </Text>
          </View>
        ))}
      </View>
      <View className="flex-1 flex-row gap-1">
        {columns.map((col, ci) => (
          <View key={ci} className="flex-1 gap-1">
            {col.map((d) => {
              const key = localDayKey(d);
              const logged = loggedDays.has(key);
              const inFuture = d.getTime() > end.getTime();
              return (
                <View
                  key={key}
                  style={
                    logged
                      ? { backgroundColor: primaryColor }
                      : undefined
                  }
                  className={`h-4 rounded ${
                    logged
                      ? ''
                      : inFuture
                        ? 'bg-gray-50 dark:bg-gray-900'
                        : 'bg-gray-200 dark:bg-gray-800'
                  }`}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
