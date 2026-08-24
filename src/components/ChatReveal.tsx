import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';

import { AIMark } from './AIMark';
import { useThemeColors } from '@/lib/theme';

// A conversation should arrive like one. These three pieces make a
// message thread read as being written rather than loaded: a typing
// indicator, a mount animation for each row, and a hook that reveals
// queued messages one at a time, paced by length. Born on the setup
// conversation; shared so the AI front desk chat behaves the same way.

// Assistant turns sit hidden until the indicator has "written" them,
// while the user's own messages always land instantly. Render-side on
// purpose: callers still append whole exchanges at once, and only the
// reveal is theatrical, so nothing about what gets asked or saved can
// drift for the sake of the animation.
export function useStagedReveal<T>(
  messages: T[],
  opts: { instant: (m: T) => boolean; textOf: (m: T) => string | null },
): { revealed: number; typing: boolean } {
  const [revealed, setRevealed] = useState(0);
  const [typing, setTyping] = useState(false);
  // Reading opts through a ref keeps inline callbacks from re-arming the
  // effect every render while a reveal timer is pending.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (revealed >= messages.length) {
      setTyping(false);
      return;
    }
    const next = messages[revealed];
    if (optsRef.current.instant(next)) {
      setRevealed((r) => r + 1);
      return;
    }
    setTyping(true);
    const text = optsRef.current.textOf(next);
    const pause = text ? Math.min(400 + text.length * 5, 1200) : 350;
    const timer = setTimeout(() => {
      setTyping(false);
      setRevealed((r) => r + 1);
    }, pause);
    return () => clearTimeout(timer);
  }, [messages, revealed]);
  return { revealed, typing };
}

// A message doesn't pop into place, it arrives: a short fade and rise on
// mount, applied to every revealed row so the whole thread reads as
// being written rather than loaded.
export function Appear({ children }: { children: ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// Three pulsing dots beside the AI mark. Also the honest face of a real
// wait: callers show it while an actual reply is being generated, not
// only during the staged reveal.
export function TypingIndicator({ side = 'start' }: { side?: 'start' | 'end' }) {
  const colors = useThemeColors();
  const a = useRef(new Animated.Value(0.25)).current;
  const b = useRef(new Animated.Value(0.25)).current;
  const c = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loops = [a, b, c].map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 280, useNativeDriver: true }),
          Animated.delay((2 - i) * 140),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View
      className={`flex-row items-start gap-2.5 ${side === 'end' ? 'self-end flex-row-reverse pl-7' : 'pr-7'}`}>
      <AIMark size={24} />
      <View
        className={`bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-2xl ${side === 'end' ? 'rounded-br-md' : 'rounded-bl-md'} px-3.5 py-3 flex-row items-center gap-1.5`}>
        {[a, b, c].map((v, i) => (
          <Animated.View
            key={i}
            style={{ opacity: v, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ink3 }}
          />
        ))}
      </View>
    </View>
  );
}
