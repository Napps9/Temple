import { useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, Pressable, View } from 'react-native';
import { Text } from './Text';
import Svg, { Path } from 'react-native-svg';

// Drawn-signature capture. Strokes are stored as an array of SVG path
// `d` strings plus the capture box, so the signature reconstructs
// identically on web and native with react-native-svg — no raster
// encoding, no react-native-view-shot, no second storage upload.
//
// PanResponder's locationX/locationY are relative to the captured
// View, and react-native-web maps mouse drags onto the same responder
// lifecycle, so the pad works with a finger on mobile and a mouse on
// the web (the primary platform here).

export type SignatureValue = {
  paths: string[];
  width: number;
  height: number;
};

const round = (n: number) => Math.round(n * 10) / 10;

export function SignaturePad({
  onChange,
  height = 180,
}: {
  // Emits the current signature, or null once cleared / before any
  // stroke, so the parent can disable submit until there's ink.
  onChange: (v: SignatureValue | null) => void;
  height?: number;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const currentRef = useRef('');
  const size = useRef({ width: 0, height });

  // Keep the latest onChange in a ref so the emit effect doesn't refire
  // on every parent render (inline callbacks change identity).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (paths.length === 0) {
      onChangeRef.current(null);
    } else {
      onChangeRef.current({
        paths,
        width: size.current.width,
        height: size.current.height,
      });
    }
  }, [paths]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          currentRef.current = `M${round(locationX)} ${round(locationY)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          currentRef.current += ` L${round(locationX)} ${round(locationY)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderRelease: () => {
          const stroke = currentRef.current;
          currentRef.current = '';
          setCurrent('');
          // Ignore a stray tap with no drag (a lone dot isn't a stroke).
          if (stroke.includes('L')) {
            setPaths((prev) => [...prev, stroke]);
          }
        },
      }),
    [],
  );

  function onLayout(e: LayoutChangeEvent) {
    size.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
  }

  function clear() {
    currentRef.current = '';
    setCurrent('');
    setPaths([]);
  }

  const hasInk = paths.length > 0 || current.length > 0;

  return (
    <View className="gap-2">
      <View
        onLayout={onLayout}
        {...responder.panHandlers}
        style={{ height }}
        className="bg-white rounded-xl border border-line-strong overflow-hidden">
        <Svg width="100%" height="100%">
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#111827"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {current ? (
            <Path
              d={current}
              stroke="#111827"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
        {!hasInk ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center">
            <Text className="text-ink-3 text-sm">Sign here</Text>
          </View>
        ) : null}
      </View>
      <View className="flex-row justify-end">
        <Pressable
          onPress={clear}
          hitSlop={8}
          disabled={!hasInk}
          className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full ${
            hasInk ? 'active:opacity-70' : 'opacity-40'
          }`}>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
            Clear
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Read-only render of a stored signature, scaled into its container via
// the captured box as the SVG viewBox.
export function SignatureView({
  value,
  height = 120,
}: {
  value: SignatureValue;
  height?: number;
}) {
  const w = value.width > 0 ? value.width : 300;
  const h = value.height > 0 ? value.height : height;
  return (
    <View
      style={{ height }}
      className="bg-white rounded-lg border border-line overflow-hidden">
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
        {value.paths.map((d, i) => (
          <Path
            key={i}
            d={d}
            stroke="#111827"
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}
