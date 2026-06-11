import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { useThemePreference } from '@/lib/theme';
import type { InjurySide } from '@/types/database';

// Gender-neutral tappable body map: two stylised mannequin figures
// (front + back) built from primitive shapes, with invisible elliptical
// hit areas per body region. Tapping a region reports its key plus the
// side inferred from which limb was tapped (front view is mirrored:
// the viewer's left is the person's right).
//
// `highlights` tints regions (both sides) — used for the member's own
// active injuries and for the coach analysis heat view. `selected`
// outlines one specific region+side while the log form is open.

type ViewKind = 'front' | 'back';

type Hit = {
  region: string;
  side: InjurySide;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

// Shared limb geometry (viewBox 0 0 120 240). Left/right here are
// screen positions; the per-view tables below assign person-sides.
function limbHits(leftSide: InjurySide, rightSide: InjurySide): Hit[] {
  return [
    { region: 'shoulder', side: leftSide, cx: 38, cy: 46, rx: 10, ry: 8 },
    { region: 'shoulder', side: rightSide, cx: 82, cy: 46, rx: 10, ry: 8 },
    { region: 'upper_arm', side: leftSide, cx: 30, cy: 62, rx: 8, ry: 14 },
    { region: 'upper_arm', side: rightSide, cx: 90, cy: 62, rx: 8, ry: 14 },
    { region: 'elbow', side: leftSide, cx: 28, cy: 80, rx: 6.5, ry: 6.5 },
    { region: 'elbow', side: rightSide, cx: 92, cy: 80, rx: 6.5, ry: 6.5 },
    { region: 'forearm', side: leftSide, cx: 27, cy: 96, rx: 6.5, ry: 12 },
    { region: 'forearm', side: rightSide, cx: 93, cy: 96, rx: 6.5, ry: 12 },
    { region: 'wrist_hand', side: leftSide, cx: 27, cy: 116, rx: 7, ry: 8 },
    { region: 'wrist_hand', side: rightSide, cx: 93, cy: 116, rx: 7, ry: 8 },
    { region: 'knee', side: leftSide, cx: 51, cy: 160, rx: 7.5, ry: 8 },
    { region: 'knee', side: rightSide, cx: 69, cy: 160, rx: 7.5, ry: 8 },
    { region: 'ankle_foot', side: leftSide, cx: 51, cy: 216, rx: 8.5, ry: 9 },
    { region: 'ankle_foot', side: rightSide, cx: 69, cy: 216, rx: 8.5, ry: 9 },
  ];
}

const FRONT_HITS: Hit[] = [
  { region: 'head', side: 'na', cx: 60, cy: 20, rx: 13, ry: 13 },
  { region: 'neck', side: 'na', cx: 60, cy: 36, rx: 8, ry: 5 },
  { region: 'chest', side: 'na', cx: 60, cy: 56, rx: 18, ry: 12 },
  { region: 'abdomen', side: 'na', cx: 60, cy: 80, rx: 16, ry: 12 },
  { region: 'hip_groin', side: 'na', cx: 60, cy: 99, rx: 16, ry: 9 },
  // Mirrored: screen-left is the person's right.
  ...limbHits('right', 'left'),
  { region: 'quad', side: 'right', cx: 50.5, cy: 128, rx: 9, ry: 23 },
  { region: 'quad', side: 'left', cx: 69.5, cy: 128, rx: 9, ry: 23 },
  { region: 'shin', side: 'right', cx: 51, cy: 188, rx: 7, ry: 19 },
  { region: 'shin', side: 'left', cx: 69, cy: 188, rx: 7, ry: 19 },
];

const BACK_HITS: Hit[] = [
  { region: 'head', side: 'na', cx: 60, cy: 20, rx: 13, ry: 13 },
  { region: 'neck', side: 'na', cx: 60, cy: 36, rx: 8, ry: 5 },
  { region: 'upper_back', side: 'na', cx: 60, cy: 58, rx: 18, ry: 14 },
  { region: 'lower_back', side: 'na', cx: 60, cy: 84, rx: 15, ry: 10 },
  { region: 'glute', side: 'na', cx: 60, cy: 101, rx: 16, ry: 9 },
  // Not mirrored: screen-left is the person's left.
  ...limbHits('left', 'right'),
  { region: 'hamstring', side: 'left', cx: 50.5, cy: 128, rx: 9, ry: 23 },
  { region: 'hamstring', side: 'right', cx: 69.5, cy: 128, rx: 9, ry: 23 },
  { region: 'calf', side: 'left', cx: 51, cy: 188, rx: 7, ry: 19 },
  { region: 'calf', side: 'right', cx: 69, cy: 188, rx: 7, ry: 19 },
];

function Figure({
  view,
  silhouetteFill,
  silhouetteStroke,
  hits,
  selected,
  highlights,
  onSelect,
  width,
}: {
  view: ViewKind;
  silhouetteFill: string;
  silhouetteStroke: string;
  hits: Hit[];
  selected?: { region: string; side: InjurySide } | null;
  highlights?: Record<string, string>;
  onSelect?: (region: string, side: InjurySide, view: ViewKind) => void;
  width: number;
}) {
  // Shared on every path so the joins read cleanly. Smooth bezier
  // silhouette built up from head/torso/arms/legs.
  const fill = silhouetteFill;
  const stroke = silhouetteStroke;
  const strokeWidth = 1.2;
  return (
    <View className="items-center gap-1">
      <Svg width={width} height={width * 2} viewBox="0 0 120 240">
        {/* Silhouette — soft fill with a defined edge so the body has
            weight without feeling blocky. */}
        <Circle
          cx={60}
          cy={17}
          r={12.5}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        {/* Torso: traps → shoulders → lats → waist taper → hips */}
        <Path
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          d="M 54 28 L 54 34 C 46 37 41 40 40 46 C 39 60 41 74 45 84 C 42 92 41 97 42 106 C 48 112 72 112 78 106 C 79 97 78 92 75 84 C 79 74 81 60 80 46 C 79 40 74 37 66 34 L 66 28 C 62 26 58 26 54 28 Z"
        />
        {/* Arms: deltoid cap → elbow → forearm taper → hand */}
        <Path
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          d="M 40 46 C 32 47 28 52 27 60 C 25 70 24 78 23 88 C 22 98 21 106 20 114 C 20 120 22 125 25 126 C 28 127 30 123 29 117 C 28 108 30 98 31 90 C 32 80 34 72 36 64 C 37 56 38 50 40 46 Z"
        />
        <Path
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          d="M 80 46 C 88 47 92 52 93 60 C 95 70 96 78 97 88 C 98 98 99 106 100 114 C 100 120 98 125 95 126 C 92 127 90 123 91 117 C 92 108 90 98 89 90 C 88 80 86 72 84 64 C 83 56 82 50 80 46 Z"
        />
        {/* Legs: thigh → knee → calf taper → heel + foot */}
        <Path
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          d="M 42 102 C 41 118 42 132 44 146 C 44 154 45 158 45 164 C 44 176 45 188 47 200 C 47 208 46 214 44 218 C 44 222 48 224 53 223 C 56 222 56 218 55 212 C 56 200 56 188 56 176 C 56 168 56 162 57 154 C 58 140 59 124 59 110 L 59 106 C 54 104 46 102 42 102 Z"
        />
        <Path
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          d="M 78 102 C 79 118 78 132 76 146 C 76 154 75 158 75 164 C 76 176 75 188 73 200 C 73 208 74 214 76 218 C 76 222 72 224 67 223 C 64 222 64 218 65 212 C 64 200 64 188 64 176 C 64 168 64 162 63 154 C 62 140 61 124 61 110 L 61 106 C 66 104 74 102 78 102 Z"
        />
        {/* Region hit areas */}
        {hits.map((h, i) => {
          const isSelected =
            selected && selected.region === h.region && selected.side === h.side;
          const tint = highlights?.[h.region];
          return (
            <Ellipse
              key={`${h.region}-${h.side}-${i}`}
              cx={h.cx}
              cy={h.cy}
              rx={h.rx}
              ry={h.ry}
              fill={isSelected ? '#2563EB' : (tint ?? 'transparent')}
              fillOpacity={isSelected ? 0.55 : tint ? 0.5 : 0}
              stroke={isSelected ? '#2563EB' : 'transparent'}
              strokeWidth={isSelected ? 2 : 0}
              onPress={
                onSelect ? () => onSelect(h.region, h.side, view) : undefined
              }
            />
          );
        })}
      </Svg>
      <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
        {view === 'front' ? 'Front' : 'Back'}
      </Text>
    </View>
  );
}

export function BodyMap({
  selected,
  highlights,
  onSelect,
  figureWidth = 120,
}: {
  selected?: { region: string; side: InjurySide } | null;
  // region key -> tint colour (applies to both sides of the region)
  highlights?: Record<string, string>;
  onSelect?: (region: string, side: InjurySide, view: ViewKind) => void;
  figureWidth?: number;
}) {
  const { scheme } = useThemePreference();
  // Soft slate fill + a darker outline so the silhouette has weight
  // without reading as a blocky mannequin.
  const silhouetteFill = scheme === 'dark' ? '#1F2937' : '#E2E8F0';
  const silhouetteStroke = scheme === 'dark' ? '#4B5563' : '#475569';
  return (
    <View className="flex-row justify-center gap-6">
      <Figure
        view="front"
        silhouetteFill={silhouetteFill}
        silhouetteStroke={silhouetteStroke}
        hits={FRONT_HITS}
        selected={selected}
        highlights={highlights}
        onSelect={onSelect}
        width={figureWidth}
      />
      <Figure
        view="back"
        silhouetteFill={silhouetteFill}
        silhouetteStroke={silhouetteStroke}
        hits={BACK_HITS}
        selected={selected}
        highlights={highlights}
        onSelect={onSelect}
        width={figureWidth}
      />
    </View>
  );
}
