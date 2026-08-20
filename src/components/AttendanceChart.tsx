import { Platform, View } from 'react-native';
import { Text } from './Text';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { useThemeColors } from '@/lib/theme';

// Web-only attendance bar chart. Native returns null; the parent
// renders an equivalent table for mobile.

export type AttendanceChartPoint = { label: string; value: number };

type Props = {
  data: AttendanceChartPoint[];
  width?: number;
  height?: number;
};

const PADDING_LEFT = 32;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 36;
const BAR_GAP = 6;

export function AttendanceChart({ data, width = 560, height = 200 }: Props) {
  const colors = useThemeColors();
  if (Platform.OS !== 'web') return null;

  if (data.length === 0) {
    return (
      <View
        style={{ width, height }}
        className="bg-white dark:bg-gray-900 rounded-xl items-center justify-center shadow-card">
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          No attendance recorded in this range.
        </Text>
      </View>
    );
  }

  const chartW = width - PADDING_LEFT - PADDING_RIGHT;
  const chartH = height - PADDING_TOP - PADDING_BOTTOM;
  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const barW = Math.max(8, (chartW - BAR_GAP * (data.length - 1)) / data.length);

  return (
    <View
      style={{ width, height }}
      className="bg-white dark:bg-gray-900 rounded-xl shadow-card">
      <Svg width={width} height={height}>
        <Line
          x1={PADDING_LEFT}
          y1={PADDING_TOP + chartH}
          x2={PADDING_LEFT + chartW}
          y2={PADDING_TOP + chartH}
          stroke="#E5E7EB"
          strokeWidth={1}
        />
        <SvgText
          x={PADDING_LEFT - 6}
          y={PADDING_TOP + 4}
          textAnchor="end"
          fill="#9CA3AF"
          fontSize={10}>
          {String(maxValue)}
        </SvgText>
        <SvgText
          x={PADDING_LEFT - 6}
          y={PADDING_TOP + chartH + 3}
          textAnchor="end"
          fill="#9CA3AF"
          fontSize={10}>
          0
        </SvgText>
        {data.map((d, i) => {
          const x = PADDING_LEFT + i * (barW + BAR_GAP);
          const h = (d.value / maxValue) * chartH;
          const y = PADDING_TOP + chartH - h;
          return (
            <Svg key={`${d.label}-${i}`}>
              <Rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={3}
                fill={colors.primary}
              />
              <SvgText
                x={x + barW / 2}
                y={PADDING_TOP + chartH + 14}
                textAnchor="middle"
                fill="#6B7280"
                fontSize={9}>
                {d.label}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>
    </View>
  );
}
