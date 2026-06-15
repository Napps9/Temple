import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// Per-step status indicator for the onboarding checklist. Three states:
//   - done    → solid emerald disk with a bold white tick
//   - partial → ring tinted in the brand primary, filled to (complete /
//               target) — the step's specific icon stays faintly inside
//   - empty   → primary-outlined hollow circle with the step's icon
//
// The partial state uses an SVG arc rather than a stroke-dasharray on a
// View border so the fraction is exact and renders the same on web and
// native (react-native-svg covers both — already pulled in for QR codes).

type IconName = ComponentProps<typeof Ionicons>['name'];

export function StatusDisk({
  size,
  done,
  partial,
  complete,
  target,
  icon,
  accent,
}: {
  size: number;
  done: boolean;
  partial: boolean;
  complete: number;
  target: number;
  icon: IconName;
  accent: string;
}) {
  if (done) {
    return (
      <View
        style={{
          width: size,
          height: size,
          backgroundColor: '#10B981',
          borderColor: '#10B981',
          borderWidth: 2,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name="checkmark" size={Math.round(size * 0.5)} color="#FFFFFF" />
      </View>
    );
  }

  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction =
    partial && target > 0 ? Math.min(1, Math.max(0, complete / target)) : 0;
  const dash = circumference * fraction;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Track: faint primary outline for the empty state — the
            partial arc draws over the top, leaving the unfinished
            portion visible underneath. */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={accent}
          strokeOpacity={0.25}
          strokeWidth={stroke}
          fill="none"
        />
        {partial ? (
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            // -90deg so the arc starts at 12 o'clock and grows
            // clockwise, matching every other progress ring on the
            // planet.
            transform={`rotate(-90 ${cx} ${cy})`}
            fill="none"
          />
        ) : null}
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name={icon} size={Math.round(size * 0.44)} color={accent} />
      </View>
    </View>
  );
}
