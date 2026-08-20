import type { ReactNode } from 'react';

// react-native-svg, stubbed for the test runner.
//
// It ships source vite cannot parse ("Unexpected token 'typeof'"), which
// is the same reason the icon font and expo-router are stubbed. The real
// module's job is drawing, and jsdom does not draw.
//
// What is kept is the element names and their attributes, because that is
// the part a render test can meaningfully ask about: whether a mark was
// drawn, which shapes it is made of, and how it was told to fill them.
// React DOM already knows the SVG attribute names, so props pass through
// as written — `fillRule` reaches the DOM as `fill-rule`, `viewBox` keeps
// its capital B — and a test can read them back the way it wrote them.
type SvgProps = {
  children?: ReactNode;
  accessibilityLabel?: string;
  [key: string]: unknown;
};

// Everything React Native names differently from the DOM, plus the props
// that exist only on the native side and would draw an unknown-attribute
// warning if they reached jsdom.
function toDom({ accessibilityLabel, ...props }: SvgProps) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  if (accessibilityLabel) out['aria-label'] = accessibilityLabel;
  return out;
}

const el =
  (Tag: 'path' | 'circle' | 'rect' | 'line' | 'ellipse' | 'text' | 'g') =>
  ({ children, ...props }: SvgProps) => <Tag {...toDom(props)}>{children}</Tag>;

export default function Svg({ children, ...props }: SvgProps) {
  return <svg {...toDom(props)}>{children}</svg>;
}

export const Path = el('path');
export const Circle = el('circle');
export const Rect = el('rect');
export const Line = el('line');
export const Ellipse = el('ellipse');
export const Text = el('text');
export const G = el('g');
