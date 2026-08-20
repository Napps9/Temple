import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Full-screen image gallery. Swipe between images (a paged ScrollView),
// double-tap or pinch to zoom, drag to pan while zoomed. Paging is locked
// while an image is zoomed so the horizontal drag pans the image instead of
// turning the page.
export function ImageGalleryModal({
  visible,
  images,
  initialIndex = 0,
  onClose,
}: {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    setZoomed(false);
    // Jump to the tapped image once the pager has laid out.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
    });
  }, [visible, initialIndex, width]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) {
      setIndex(i);
      setZoomed(false);
    }
  };

  if (images.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      {/* Native modals portal outside the app-root GestureHandlerRootView,
          so the pinch/pan/double-tap gestures need their own root here. */}
      <GestureHandlerRootView style={{ flex: 1 }} className="bg-black">
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}>
          {images.map((uri, i) => (
            <ZoomableImage
              key={`${uri}-${i}`}
              uri={uri}
              width={width}
              height={height}
              active={i === index}
              onZoomChange={(z) => {
                if (i === index) setZoomed(z);
              }}
            />
          ))}
        </ScrollView>

        {images.length > 1 ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: insets.top + 12, left: 0, right: 0 }}
            className="items-center">
            <View className="rounded-full bg-black/60 px-3 py-1">
              <Text className="text-white text-sm font-medium">
                {index + 1} / {images.length}
              </Text>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close gallery"
          style={{ position: 'absolute', top: insets.top + 6, right: 12 }}
          className="w-10 h-10 rounded-full bg-black/60 items-center justify-center active:opacity-70">
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomableImage({
  uri,
  width,
  height,
  active,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // React mirror of "is this image zoomed", so the pan gesture (which would
  // otherwise fight the pager) is only enabled once zoomed in.
  const [zoomed, setZoomed] = useState(false);

  const reset = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  // A swiped-away image springs back to 1x so it's fresh when revisited.
  useEffect(() => {
    if (!active) {
      reset();
      setZoomed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const setZoom = (z: boolean) => {
    setZoomed(z);
    onZoomChange(z);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(setZoom)(false);
      } else {
        savedScale.value = scale.value;
        runOnJS(setZoom)(true);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1.01) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(setZoom)(false);
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
        runOnJS(setZoom)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      style={{ width, height }}
      className="items-center justify-center">
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, style]}>
          <Image
            source={{ uri }}
            style={{ width, height }}
            resizeMode="contain"
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
