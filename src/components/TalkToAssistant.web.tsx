import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import Vapi from '@vapi-ai/web';

import { copyToClipboard } from '@/lib/clipboard';
import { errorMessage } from '@/lib/errors';
import { useThemeColors } from '@/lib/theme';
import {
  finalTranscriptTurn,
  formatCallDuration,
  transcriptToText,
  type TranscriptTurn,
} from '@/lib/vapi-call';

const VAPI_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPI_KEY;

type Phase = 'ready' | 'connecting' | 'live' | 'ended';

function useVapiCall(assistantId: string | null) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<InstanceType<typeof Vapi> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const available = !!assistantId && !!VAPI_PUBLIC_KEY;

  useEffect(
    () => () => {
      vapiRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  function start() {
    if (!available || !assistantId) return;
    setError(null);
    setTurns([]);
    setDuration(0);
    setPhase('connecting');
    const vapi = new Vapi(VAPI_PUBLIC_KEY as string);
    vapiRef.current = vapi;

    vapi.on('call-start', () => {
      setPhase('live');
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    });
    vapi.on('speech-start', () => setSpeaking(true));
    vapi.on('speech-end', () => setSpeaking(false));
    vapi.on('message', (message) => {
      const turn = finalTranscriptTurn(message);
      if (turn) setTurns((t) => [...t, turn]);
    });
    vapi.on('call-end', () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setSpeaking(false);
      setPhase('ended');
    });
    vapi.on('error', (e) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setError(errorMessage(e, "Couldn't connect the call"));
      setPhase('ready');
    });

    vapi.start(assistantId).catch((e) => {
      setError(errorMessage(e, "Couldn't connect the call"));
      setPhase('ready');
    });
  }

  function end() {
    vapiRef.current?.end();
  }

  function reset() {
    setPhase('ready');
    setTurns([]);
    setDuration(0);
    setError(null);
  }

  return { phase, speaking, turns, duration, error, available, start, end, reset };
}

type CallState = ReturnType<typeof useVapiCall>;

export type TalkToAssistantProps = {
  assistantId: string | null;
  gymName?: string;
  // 'inline' sits in a card in the normal page flow (wizard, settings).
  // 'docked' floats bottom-right over a dimmed backdrop and calls
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
    if (presentation === 'docked') return null;
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1 shadow-card">
        <Text className="text-gray-900 dark:text-gray-50 font-medium">Talk to it</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          {assistantId
            ? "Voice testing isn't set up on this account yet."
            : 'Finish setting up your assistant first, then you can talk to it here.'}
        </Text>
      </View>
    );
  }

  const panel = (
    <CallPanel call={call} colors={colors} gymName={gymName} onRequestClose={onRequestClose} />
  );

  if (presentation !== 'docked') return panel;

  return (
    <View
      // Fixed overlay: dims the dashboard behind it without navigating
      // away, so the pipeline stays visible per the approved mockup.
      style={{ position: 'fixed' as 'absolute', inset: 0, zIndex: 50 }}
      pointerEvents="box-none">
      <Pressable
        onPress={call.phase === 'ended' ? onRequestClose : undefined}
        accessibilityLabel="Dimmed background"
        className="absolute inset-0 bg-black/40"
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
    <View className="bg-white dark:bg-gray-900 rounded-2xl p-4 gap-3 shadow-pop">
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
        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
          Ready to talk?
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
          We'll ask your browser for microphone access next.
        </Text>
      </View>
      <Text className="text-gray-400 dark:text-gray-500 text-[11px] text-center">
        Test call — kept separate from your leads and pipeline
      </Text>
      {call.error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs text-center">{call.error}</Text>
      ) : null}
      <View className="flex-row gap-2 self-stretch">
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            className="flex-1 py-2.5 rounded-lg items-center border border-gray-200 dark:border-gray-700">
            <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={call.start}
          className="flex-1 py-2.5 rounded-lg items-center bg-primary">
          <Text className="font-semibold text-sm" style={{ color: '#FFFFFF' }}>
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
        <Text className="text-gray-900 dark:text-gray-50 font-medium text-sm">Connecting…</Text>
        <Text className="text-gray-400 dark:text-gray-500 text-xs">Setting up secure audio</Text>
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
        <Text className="text-gray-500 dark:text-gray-400 text-xs font-medium">
          {formatCallDuration(call.duration)}
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <VoiceOrb speaking={call.speaking} color={colors.primary} />
        <View>
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">
            {call.speaking ? 'Speaking…' : 'Listening…'}
          </Text>
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
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
                  : 'self-start bg-gray-100 dark:bg-gray-800'
              }`}>
              <Text className="text-gray-900 dark:text-gray-50 text-xs">{t.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <Text className="text-gray-400 dark:text-gray-500 text-[11px] text-center">
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
        <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">Call ended</Text>
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          {formatCallDuration(call.duration)}
        </Text>
      </View>

      <ScrollView className="max-h-40" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          {call.turns.length === 0 ? (
            <Text className="text-gray-400 dark:text-gray-500 text-xs text-center py-4">
              No speech was picked up on that call.
            </Text>
          ) : (
            call.turns.map((t, i) => (
              <View
                key={i}
                className={`max-w-[86%] rounded-xl px-3 py-2 ${
                  t.role === 'user'
                    ? 'self-end bg-primary/10'
                    : 'self-start bg-gray-100 dark:bg-gray-800'
                }`}>
                <Text className="text-gray-900 dark:text-gray-50 text-xs">{t.text}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Text className="text-gray-400 dark:text-gray-500 text-[11px] text-center">
        Not saved as a lead — read it back anytime under Conversations
      </Text>

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => copyToClipboard(transcriptToText(call.turns))}
          disabled={call.turns.length === 0}
          className={`flex-1 py-2.5 rounded-lg items-center border border-gray-200 dark:border-gray-700 ${
            call.turns.length === 0 ? 'opacity-50' : ''
          }`}>
          <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
            Copy transcript
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            call.reset();
            onClose?.();
          }}
          className="flex-1 py-2.5 rounded-lg items-center bg-primary">
          <Text className="font-semibold text-sm" style={{ color: '#FFFFFF' }}>
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
