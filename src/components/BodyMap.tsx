import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Rect } from 'react-native-svg';

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
  silhouette,
  hits,
  selected,
  highlights,
  onSelect,
  width,
}: {
  view: ViewKind;
  silhouette: string;
  hits: Hit[];
  selected?: { region: string; side: InjurySide } | null;
  highlights?: Record<string, string>;
  onSelect?: (region: string, side: InjurySide, view: ViewKind) => void;
  width: number;
}) {
  return (
    <View className="items-center gap-1">
      <Svg width={width} height={width * 2} viewBox="0 0 120 240">
        {/* Mannequin */}
        <Circle cx={60} cy={20} r={13} fill={silhouette} />
        <Rect x={54} y={31} width={12} height={9} fill={silhouette} />
        <Rect x={40} y={40} width={40} height={62} rx={10} fill={silhouette} />
        <Rect x={23} y={42} width={13} height={38} rx={6.5} fill={silhouette} />
        <Rect x={84} y={42} width={13} height={38} rx={6.5} fill={silhouette} />
        <Rect x={21} y={82} width={11} height={28} rx={5.5} fill={silhouette} />
        <Rect x={88} y={82} width={11} height={28} rx={5.5} fill={silhouette} />
        <Circle cx={27} cy={116} r={6} fill={silhouette} />
        <Circle cx={93} cy={116} r={6} fill={silhouette} />
        <Rect x={43} y={102} width={15} height={56} rx={7} fill={silhouette} />
        <Rect x={62} y={102} width={15} height={56} rx={7} fill={silhouette} />
        <Rect x={45} y={158} width={12} height={52} rx={6} fill={silhouette} />
        <Rect x={63} y={158} width={12} height={52} rx={6} fill={silhouette} />
        <Ellipse cx={51} cy={215} rx={8} ry={6} fill={silhouette} />
        <Ellipse cx={69} cy={215} rx={8} ry={6} fill={silhouette} />
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
  const silhouette = scheme === 'dark' ? '#374151' : '#CBD5E1';
  return (
    <View className="flex-row justify-center gap-6">
      <Figure
        view="front"
        silhouette={silhouette}
        hits={FRONT_HITS}
        selected={selected}
        highlights={highlights}
        onSelect={onSelect}
        width={figureWidth}
      />
      <Figure
        view="back"
        silhouette={silhouette}
        hits={BACK_HITS}
        selected={selected}
        highlights={highlights}
        onSelect={onSelect}
        width={figureWidth}
      />
    </View>
  );
}
