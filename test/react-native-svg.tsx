import type { ReactNode } from 'react';

// react-native-svg, stubbed for the test runner.
//
// It ships source vite cannot parse ("Unexpected token 'typeof'"), which
// is the same reason the icon font and expo-router are stubbed. The real
// module's job is drawing, and jsdom does not draw.
//
// What is kept is the element names, because that is the part a render
// test can meaningfully ask about: whether a mark was drawn at all, and
// which one. Everything else is a hole where a vector goes.
type SvgProps = {
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  d?: string;
  [key: string]: unknown;
};

const el =
  (tag: string) =>
  ({ children, ...props }: SvgProps) => {
    // React would warn on unknown camelCase DOM attributes; the ones a
    // test cares about (d, fill, viewBox) are valid SVG attributes and
    // pass straight through.
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'string' || typeof v === 'number') safe[k.toLowerCase()] = v;
    }
    return <g {...safe}>{children}</g>;
  };

export default function Svg({ children, ...props }: SvgProps) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string' || typeof v === 'number') safe[k.toLowerCase()] = v;
  }
  return <svg {...safe}>{children}</svg>;
}

export const Path = el('path');
export const Circle = el('circle');
export const Rect = el('rect');
export const Line = el('line');
export const Ellipse = el('ellipse');
export const Text = el('text');
