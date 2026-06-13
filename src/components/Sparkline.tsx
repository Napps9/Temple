import { View } from 'react-native';

// A tiny View-based line chart — no chart libs, consistent with the
// rest of Track. Takes y-positions in 0..1 (1 = top / "best") and
// draws a polyline of thin segments between consecutive points. The
// last point gets a filled dot so the current value is obvious.
export function Sparkline({
  values,
  color,
  height = 36,
  width = 120,
}: {
  values: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (values.length < 2) return null;

  const pad = 4;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;
  const stepX = innerW / (values.length - 1);

  // Each consecutive pair becomes one absolutely-positioned, rotated
  // bar. dx is constant (stepX); dy varies with the value delta.
  const segments = [];
  for (let i = 0; i < values.length - 1; i++) {
    const x1 = pad + i * stepX;
    const y1 = pad + (1 - values[i]) * innerH;
    const x2 = pad + (i + 1) * stepX;
    const y2 = pad + (1 - values[i + 1]) * innerH;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    segments.push(
      <View
        key={i}
        style={{
          position: 'absolute',
          left: x1,
          top: y1 - 1,
          width: len,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          transform: [
            { translateX: 0 },
            { rotateZ: `${angle}rad` },
          ],
          transformOrigin: 'left center',
        }}
      />,
    );
  }

  const lastX = pad + (values.length - 1) * stepX;
  const lastY = pad + (1 - values[values.length - 1]) * innerH;

  return (
    <View style={{ width, height }}>
      {segments}
      <View
        style={{
          position: 'absolute',
          left: lastX - 3,
          top: lastY - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
