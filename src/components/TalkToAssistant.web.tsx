import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { copyToClipboard } from '@/lib/clipboard';
import { useThemeColors } from '@/lib/theme';
import { formatCallDuration, transcriptToText } from '@/lib/vapi-call';
import { useVapiCall } from '@/lib/useVapiCall';

type CallState = ReturnType<typeof useVapiCall>;

export type TalkToAssistantProps = {
  assistantId: string | null;
  gymName?: string;
  // 'inline' sits in a card in the normal page flow (wizard, settings).
  // 'docked' floats bottom-right, its own shadow (shadow-float) doing the
  // elevation instead of dimming the page behind it — the dashboard stays
  // fully readable and interactive while this is open. Calls
  // onRequestClose when the owner closes it (the dashboard placement).
  presentation?: 'inline' | 'docked';
  onRequestClose?: () => void;
};

export function TalkToAssistant({
  assistantId,
  gymName,
  presentation = 'inline',
  onRequestClose,
}: TalkToAssistantProps) {
  const call = useVapiCall(assistantId);
  const colors = useThemeColors();

  if (!call.available) {
    const card = (
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1">
        <Text className="text-ink dark:text-ink-dk font-medium">Talk to it</Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {assistantId
            ? "Browser calling isn't connected yet — the Vapi public key (EXPO_PUBLIC_VAPI_KEY) hasn't been added to this deployment."
            : 'Finish setting up your assistant first, then you can talk to it here.'}
        </Text>
        {presentation === 'docked' && onRequestClose ? (
          <Pressable onPress={onRequestClose} hitSlop={6} className="self-end pt-1">
            <Text className="text-primary text-xs font-semibold">Close</Text>
          </Pressable>
        ) : null}
      </View>
    );
    if (presentation !== 'docked') return card;
    return (
      <View
        style={{ position: 'fixed' as 'absolute', inset: 0, zIndex: 50 }}
        pointerEvents="box-none">
        <Pressable
          onPress={onRequestClose}
          accessibilityLabel="Close talk-to-it panel"
          className="absolute inset-0"
        />
        <View
          style={{ position: 'fixed' as 'absolute', right: 20, bottom: 20, width: 340, maxWidth: '92%' }}>
          {card}
        </View>
      </View>
    );
  }

  const panel = (
    <CallPanel call={call} colors={colors} gymName={gymName} onRequestClose={onRequestClose} />
  );

  if (presentation !== 'docked') return panel;

  return (
    <View
      // Fixed overlay: an invisible click-outside-to-dismiss layer, not a
      // dimmed one — the dashboard stays fully visible and readable behind
      // the floating panel, whose own shadow (shadow-float) is what reads as
      // "above" the page.
      style={{ position: 'fixed' as 'absolute', inset: 0, zIndex: 50 }}
      pointerEvents="box-none">
      <Pressable
        onPress={call.phase === 'ended' ? onRequestClose : undefined}
        accessibilityLabel="Close talk-to-it panel"
        className="absolute inset-0"
      />
      <View
        style={{ position: 'fixed' as 'absolute', right: 20, bottom: 20, width: 340, maxWidth: '92%' }}>
        {panel}
      </View>
    </View>
  );
}

function CallPanel({
  call,
  colors,
  gymName,
  onRequestClose,
}: {
  call: CallState;
  colors: ReturnType<typeof useThemeColors>;
  gymName?: string;
  onRequestClose?: () => void;
}) {
  return (
    <View className="bg-surface dark:bg-surface-dk rounded-2xl p-4 gap-3 shadow-float">
      {call.phase === 'ready' ? (
        <ReadyBody call={call} colors={colors} onCancel={onRequestClose} />
      ) : call.phase === 'connecting' ? (
        <ConnectingBody colors={colors} />
      ) : call.phase === 'live' ? (
        <LiveBody call={call} colors={colors} gymName={gymName} />
      ) : (
        <EndedBody call={call} onClose={onRequestClose} />
      )}
    </View>
  );
}

function ReadyBody({
  call,
  colors,
  onCancel,
}: {
  call: CallState;
  colors: ReturnType<typeof useThemeColors>;
  onCancel?: () => void;
}) {
  return (
    <View className="gap-3 items-center py-1">
      <View
        className="w-11 h-11 rounded-full items-center justify-center bg-primary/10">
        <Ionicons name="mic-outline" size={20} color={colors.primary} />
      </View>
      <View className="gap-1 items-center">
        <Text className="text-ink dark:text-ink-dk font-semibold text-base">
          Ready to talk?
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs text-center">
          We'll ask your browser for microphone access next.
        </Text>
      </View>
      <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] text-center">
        Test call — kept separate from your leads and pipeline
      </Text>
      {call.error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs text-center">{call.error}</Text>
      ) : null}
      <View className="flex-row gap-2 self-stretch">
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            className="flex-1 py-2.5 rounded-lg items-center border border-line dark:border-line-dk">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={call.start}
          className="flex-1 py-2.5 rounded-lg items-center bg-primary">
          <Text className="font-semibold text-sm text-on-primary">
            Allow &amp; start
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConnectingBody({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View className="gap-3 items-center py-3">
      <ActivityIndicator size="large" color={colors.primary} />
      <View className="gap-0.5 items-center">
        <Text className="text-ink dark:text-ink-dk font-medium text-sm">Connecting…</Text>
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">Setting up secure audio</Text>
      </View>
    </View>
  );
}

function LiveBody({
  call,
  colors,
  gymName,
}: {
  call: CallState;
  colors: ReturnType<typeof useThemeColors>;
  gymName?: string;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5 bg-red-500/10 rounded-full px-2.5 py-1">
          <View className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <Text className="text-red-600 dark:text-red-400 text-[11px] font-bold">LIVE</Text>
        </View>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
          {formatCallDuration(call.duration)}
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <VoiceOrb speaking={call.speaking} color={colors.primary} />
        <View>
          <Text className="text-ink dark:text-ink-dk font-semibold text-sm">
            {call.speaking ? 'Speaking…' : 'Listening…'}
          </Text>
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            {gymName ? `${gymName} AI` : 'Your AI'}
          </Text>
        </View>
      </View>

      <ScrollView className="max-h-40" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          {call.turns.map((t, i) => (
            <View
              key={i}
              className={`max-w-[86%] rounded-xl px-3 py-2 ${
                t.role === 'user'
                  ? 'self-end bg-primary/10'
                  : 'self-start bg-raised dark:bg-raised-dk'
              }`}>
              <Text className="text-ink dark:text-ink-dk text-xs">{t.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] text-center">
        Test call — kept separate from your leads and pipeline
      </Text>

      <View className="items-center">
        <Pressable
          onPress={call.end}
          accessibilityLabel="End call"
          className="w-11 h-11 rounded-full items-center justify-center bg-red-500">
          <Ionicons name="call" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function EndedBody({ call, onClose }: { call: CallState; onClose?: () => void }) {
  return (
    <View className="gap-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-ink dark:text-ink-dk font-semibold text-sm">Call ended</Text>
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
          {formatCallDuration(call.duration)}
        </Text>
      </View>

      <ScrollView className="max-h-40" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          {call.turns.length === 0 ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center py-4">
              No speech was picked up on that call.
            </Text>
          ) : (
            call.turns.map((t, i) => (
              <View
                key={i}
                className={`max-w-[86%] rounded-xl px-3 py-2 ${
                  t.role === 'user'
                    ? 'self-end bg-primary/10'
                    : 'self-start bg-raised dark:bg-raised-dk'
                }`}>
                <Text className="text-ink dark:text-ink-dk text-xs">{t.text}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] text-center">
        Not saved as a lead — read it back anytime under Conversations
      </Text>

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => copyToClipboard(transcriptToText(call.turns))}
          disabled={call.turns.length === 0}
          className={`flex-1 py-2.5 rounded-lg items-center border border-line dark:border-line-dk ${
            call.turns.length === 0 ? 'opacity-50' : ''
          }`}>
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
            Copy transcript
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            call.reset();
            onClose?.();
          }}
          className="flex-1 py-2.5 rounded-lg items-center bg-primary">
          <Text className="font-semibold text-sm text-on-primary">
            Close
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Three bars that bounce while the assistant is speaking, and sit calm
// (a slow glow pulse only) while it's listening — colour tracking who's
// "active" would need a second brand colour with no established
// per-gym equivalent, so intensity carries that instead.
function VoiceOrb({ speaking, color }: { speaking: boolean; color: string }) {
  const glow = useRef(new Animated.Value(0)).current;
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.35))).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  useEffect(() => {
    if (!speaking) {
      bars.forEach((b) => b.setValue(0.35));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 130),
          Animated.timing(b, { toValue: 1, duration: 260, useNativeDriver: false }),
          Animated.timing(b, { toValue: 0.35, duration: 260, useNativeDriver: false }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [speaking, bars]);

  return (
    <View className="items-center justify-center" style={{ width: 46, height: 46 }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: color,
          opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.32] }),
          transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
        }}
      />
      <View
        className="items-center justify-center flex-row"
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color, gap: 3 }}>
        {bars.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              width: 3,
              borderRadius: 2,
              backgroundColor: '#FFFFFF',
              height: 14,
              transform: [{ scaleY: b }],
            }}
          />
        ))}
      </View>
    </View>
  );
}
