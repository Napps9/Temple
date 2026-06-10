import { createElement, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { ColorSwatchPicker } from './ColorSwatchPicker';
import { hexToHsv, hsvToHex, type Hsv } from '@/lib/colour';

// Inline saturation/value square + hue slider (web). Replaces the flat
// <input type="color"> rectangle — the full picker is visible and
// draggable in place, so the live preview beside it updates per drag.
// Native falls back to the quick-pick swatches.
//
// Hue is kept in local state rather than re-derived from the hex value:
// greys and near-greys collapse hue to 0 on round-trip, which made the
// hue thumb snap left whenever you dragged value to black.
export function ColourArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const initial = hexToHsv(value) ?? { h: 217, s: 0.84, v: 0.92 };
  const [hsv, setHsv] = useState<Hsv>(initial);
  const lastEmitted = useRef(value.toUpperCase());

  // If the parent value changed from outside (typed hex / swatch tap),
  // re-seed local HSV so the thumbs follow.
  const incoming = value.toUpperCase();
  if (incoming !== lastEmitted.current) {
    const parsed = hexToHsv(incoming);
    if (parsed) {
      lastEmitted.current = incoming;
      setHsv(parsed);
    }
  }

  function emit(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    lastEmitted.current = hex;
    onChange(hex);
  }

  if (Platform.OS !== 'web') {
    return <ColorSwatchPicker value={value} onChange={onChange} />;
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const svSquare = createElement('div', {
    style: {
      position: 'relative',
      width: '100%',
      height: 160,
      borderRadius: 10,
      cursor: 'crosshair',
      touchAction: 'none',
      backgroundColor: hueColor,
      backgroundImage:
        'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))',
    },
    onPointerDown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      emit({
        ...hsv,
        s: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        v: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)),
      });
    },
    onPointerMove: (e: PointerEvent & { currentTarget: HTMLElement }) => {
      if (e.buttons !== 1) return;
      const rect = e.currentTarget.getBoundingClientRect();
      emit({
        ...hsv,
        s: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        v: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)),
      });
    },
    children: createElement('div', {
      style: {
        position: 'absolute',
        left: `${hsv.s * 100}%`,
        top: `${(1 - hsv.v) * 100}%`,
        width: 16,
        height: 16,
        marginLeft: -8,
        marginTop: -8,
        borderRadius: 8,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,.4)',
        backgroundColor: hsvToHex(hsv),
        pointerEvents: 'none',
      },
    }),
  });

  const hueStrip = createElement('div', {
    style: {
      position: 'relative',
      width: '100%',
      height: 16,
      borderRadius: 8,
      cursor: 'pointer',
      touchAction: 'none',
      background:
        'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
    },
    onPointerDown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      emit({
        ...hsv,
        h: Math.min(359.9, Math.max(0, ((e.clientX - rect.left) / rect.width) * 360)),
      });
    },
    onPointerMove: (e: PointerEvent & { currentTarget: HTMLElement }) => {
      if (e.buttons !== 1) return;
      const rect = e.currentTarget.getBoundingClientRect();
      emit({
        ...hsv,
        h: Math.min(359.9, Math.max(0, ((e.clientX - rect.left) / rect.width) * 360)),
      });
    },
    children: createElement('div', {
      style: {
        position: 'absolute',
        left: `${(hsv.h / 360) * 100}%`,
        top: -2,
        width: 8,
        height: 20,
        marginLeft: -4,
        borderRadius: 4,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,.4)',
        backgroundColor: hueColor,
        pointerEvents: 'none',
      },
    }),
  });

  return (
    <View className="gap-3">
      {svSquare}
      {hueStrip}
    </View>
  );
}
