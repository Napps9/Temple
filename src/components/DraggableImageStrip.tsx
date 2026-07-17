import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Image,
  type LayoutRectangle,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/lib/theme';

const SIZE = 72;

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// A reorderable strip of product photos. Long-press a thumbnail to pick it
// up, drag it over another slot and release to drop it there; the first
// image is the cover. Works with mouse-drag on web and touch on native.
export function DraggableImageStrip({
  images,
  onChange,
  onAdd,
  uploading,
  max = 8,
}: {
  images: string[];
  onChange: (next: string[]) => void;
  onAdd: () => void;
  uploading: boolean;
  max?: number;
}) {
  const colors = useThemeColors();
  const layouts = useRef<Record<number, LayoutRectangle>>({});
  const [dragging, setDragging] = useState<number | null>(null);

  const handleDrop = (from: number, dx: number, dy: number) => {
    const src = layouts.current[from];
    if (!src) return;
    const cx = src.x + src.width / 2 + dx;
    const cy = src.y + src.height / 2 + dy;
    let best = from;
    let bestDist = Infinity;
    for (let i = 0; i < images.length; i += 1) {
      const l = layouts.current[i];
      if (!l) continue;
      const ex = l.x + l.width / 2 - cx;
      const ey = l.y + l.height / 2 - cy;
      const dist = ex * ex + ey * ey;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best !== from) onChange(arrayMove(images, from, best));
  };

  return (
    <View className="flex-row flex-wrap gap-2">
      {images.map((uri, i) => (
        <Thumb
          key={uri}
          uri={uri}
          index={i}
          isCover={i === 0}
          dimmed={dragging !== null && dragging !== i}
          onLayout={(idx, layout) => {
            layouts.current[idx] = layout;
          }}
          onRemove={(idx) => onChange(images.filter((_, j) => j !== idx))}
          onDragStart={setDragging}
          onDrop={handleDrop}
          onDragEnd={() => setDragging(null)}
        />
      ))}

      {images.length < max ? (
        <Pressable
          onPress={onAdd}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={uploading ? 'Uploading photo' : 'Add photos'}
          style={{ width: SIZE, height: SIZE }}
          className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 items-center justify-center active:opacity-70">
          <Ionicons
            name={uploading ? 'cloud-upload-outline' : 'add'}
            size={22}
            color={colors.iconSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function Thumb({
  uri,
  index,
  isCover,
  dimmed,
  onLayout,
  onRemove,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  uri: string;
  index: number;
  isCover: boolean;
  dimmed: boolean;
  onLayout: (index: number, layout: LayoutRectangle) => void;
  onRemove: (index: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number, dx: number, dy: number) => void;
  onDragEnd: () => void;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      lift.value = withTiming(1);
      runOnJS(onDragStart)(index);
    })
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onDrop)(index, e.translationX, e.translationY);
      dx.value = 0;
      dy.value = 0;
      lift.value = withTiming(0);
      runOnJS(onDragEnd)();
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: 1 + lift.value * 0.08 },
    ],
    zIndex: lift.value > 0 ? 20 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={(e) => onLayout(index, e.nativeEvent.layout)}
        style={[{ width: SIZE, height: SIZE }, style]}
        className={dimmed ? 'opacity-60' : ''}>
        <Image
          source={{ uri }}
          style={{ width: SIZE, height: SIZE }}
          className="rounded-lg"
        />
        {isCover ? (
          <View className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5">
            <Text className="text-white text-[9px] font-semibold uppercase tracking-wide">
              Cover
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => onRemove(index)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Remove photo"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/85 items-center justify-center active:opacity-70">
          <Ionicons name="close" size={12} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
