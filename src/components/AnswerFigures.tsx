import { View } from 'react-native';
import { Text } from './Text';

import {
  barHeights,
  peakIndex,
  type ActionAnswer,
  type AnswerRow,
} from '@/lib/answer';
import { useThemeColors } from '@/lib/theme';

// How an `ask` answer draws its numbers. One vocabulary for every
// question rather than a renderer per question — a stat tile, a short run
// of bars, and a ranked list — sitting above the prose the action wrote.
//
// Deliberately not a chart library, and deliberately not a chart. The
// forms here are the ones the data's job actually asks for: a single
// value with a change is a stat tile (never a one-bar bar chart), a short
// run of counts is bars, and a set of names is a list. Everything is one
// series in one hue, so there is nothing to tell apart and no legend to
// carry — which is also why no categorical palette exists here to
// validate.
//
// The hue is the gym's own brand primary. Marks carry it; text never
// does. There is no hover layer because this renders in a chat stream on
// a phone, so the one thing an owner would reach for — which day was
// busiest — is labelled directly instead.

const BAR_HEIGHT = 44;

function Delta({ direction, text }: { direction: 'up' | 'down' | 'level'; text: string }) {
  // No colour, on purpose. Attendance down is not automatically bad news
  // and the prose underneath is careful about when a change means
  // anything at all; painting this red would overrule it.
  const glyph = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  return (
    <Text className="text-gray-500 dark:text-gray-400 text-[13px]">
      {glyph} {text}
    </Text>
  );
}

function Bars({
  points,
  tint,
}: {
  points: { label: string; value: number }[];
  tint: string;
}) {
  const heights = barHeights(points);
  const peak = peakIndex(points);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-end gap-[3px]" style={{ height: BAR_HEIGHT }}>
        {points.map((p, i) => (
          <View
            key={`${p.label}-${i}`}
            className="flex-1 rounded-[3px] bg-gray-100 dark:bg-gray-800 justify-end"
            style={{ height: BAR_HEIGHT }}>
            {/* A day with nobody in keeps its rail rather than vanishing:
                a missing bar reads as a missing day. */}
            <View
              className="rounded-[3px]"
              style={{
                height: Math.max(2, Math.round(heights[i] * BAR_HEIGHT)),
                backgroundColor: tint,
                opacity: heights[i] === 0 ? 0 : 1,
              }}
            />
          </View>
        ))}
      </View>
      <View className="flex-row gap-[3px]">
        {points.map((p, i) => (
          <Text
            key={`l-${p.label}-${i}`}
            numberOfLines={1}
            className={`flex-1 text-center text-[10px] ${
              i === peak
                ? 'text-gray-700 dark:text-gray-200 font-semibold'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
            {i === peak ? `${p.label} ${p.value}` : p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Row({ row, tint }: { row: AnswerRow; tint: string }) {
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline gap-2">
        <Text
          numberOfLines={1}
          className="flex-1 text-gray-700 dark:text-gray-200 text-[13.5px]">
          {row.name}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-[13px]">{row.detail}</Text>
      </View>
      {row.weight === undefined ? null : (
        <View className="h-[3px] rounded-full bg-gray-100 dark:bg-gray-800">
          <View
            className="h-[3px] rounded-full"
            style={{
              width: `${Math.max(2, Math.round(row.weight * 100))}%`,
              backgroundColor: tint,
            }}
          />
        </View>
      )}
    </View>
  );
}

export function AnswerFigures({ answer }: { answer: ActionAnswer }) {
  const tint = useThemeColors().primary;
  if (!answer.figure && !answer.series && !answer.list) return null;

  return (
    <View className="gap-3.5 pt-0.5">
      {answer.figure ? (
        <View className="gap-0.5">
          <Text className="text-gray-900 dark:text-gray-50 text-[30px] font-semibold leading-9">
            {answer.figure.value}
          </Text>
          {/* The delta on its own line rather than beside the label: in a
              chat card both together wrap mid-phrase on a phone. */}
          <Text className="text-gray-500 dark:text-gray-400 text-[13px]">
            {answer.figure.label}
          </Text>
          {answer.figure.delta ? <Delta {...answer.figure.delta} /> : null}
        </View>
      ) : null}

      {answer.series && answer.series.points.length > 1 ? (
        <View className="gap-1.5">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-semibold uppercase tracking-wide">
            {answer.series.label}
          </Text>
          <Bars points={answer.series.points} tint={tint} />
        </View>
      ) : null}

      {answer.list && answer.list.rows.length > 0 ? (
        <View className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-semibold uppercase tracking-wide">
            {answer.list.label}
          </Text>
          {answer.list.rows.map((r) => (
            <Row key={r.name} row={r} tint={tint} />
          ))}
          {answer.list.more ? (
            <Text className="text-gray-400 dark:text-gray-500 text-[12.5px]">
              and {answer.list.more} more
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
