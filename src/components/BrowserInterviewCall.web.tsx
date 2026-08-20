import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useVapiCall, type VapiAssistantConfig } from '@/lib/useVapiCall';
import { formatCallDuration } from '@/lib/vapi-call';

export type BrowserInterviewCallProps = {
  gymId: string;
  // Fired once the transcript is safely saved — the parent re-fetches the
  // interview row, which now carries the draft brief, and the "review &
  // apply" step takes over unchanged from the phone path.
  onCompleted: () => void;
  onCancel: () => void;
};

// Runs the "teach it by talking" interview entirely in the browser — no
// outbound call, no VAPI_INTERVIEW_NUMBER_ID needed. agent-interview/
// browser-start hands back an inline assistant config (deliberately no
// webhook/secret in it, see that function's comment) that @vapi-ai/web runs
// directly; the transcript this component already has client-side (same
// live-caption capture as TalkToAssistant) is POSTed to
// agent-interview/submit-transcript once the call ends, which does the same
// Claude distillation /end-of-call does for phone calls.
export function BrowserInterviewCall({ gymId, onCompleted, onCancel }: BrowserInterviewCallProps) {
  const colors = useThemeColors();
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<VapiAssistantConfig | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const begin = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.functions.invoke('agent-interview/browser-start', {
        body: { gym_id: gymId },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
      return data as { interview_id: string; assistant: VapiAssistantConfig };
    },
    onSuccess: (data) => {
      setPrepError(null);
      setInterviewId(data.interview_id);
      setAssistant(data.assistant);
    },
    onError: (e) => setPrepError(errorMessage(e, "Couldn't set up the call")),
  });

  useEffect(() => {
    begin.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = useVapiCall(assistant);

  const submit = useMutation({
    mutationFn: async () => {
      if (!interviewId) throw new Error('Nothing to save');
      const { error: e } = await supabase.functions.invoke('agent-interview/submit-transcript', {
        body: { interview_id: interviewId, turns: call.turns },
      });
      if (e) throw e;
    },
    onSuccess: () => onCompleted(),
    onError: (e) => setPrepError(errorMessage(e, "Couldn't save the call")),
  });

  useEffect(() => {
    if (call.phase === 'ended' && !submittedRef.current) {
      submittedRef.current = true;
      submit.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.phase]);

  function handleCancel() {
    if (interviewId && call.phase !== 'ended') {
      // Best-effort — an abandoned 'calling' row is harmless clutter even if
      // this fails, so there's nothing useful to surface if it does.
      (async () => {
        try {
          await supabase.rpc('set_agent_interview_status', {
            p_id: interviewId,
            p_status: 'discarded',
          });
        } catch {
          // ignore
        }
      })();
    }
    onCancel();
  }

  if (prepError && !assistant) {
    return (
      <View className="gap-2">
        <Text className="text-red-500 dark:text-red-400 text-sm">{prepError}</Text>
        <Pressable onPress={onCancel} hitSlop={6} className="self-start">
          <Text className="text-primary text-xs font-semibold">Back to calling by phone</Text>
        </Pressable>
      </View>
    );
  }

  if (!call.available) {
    return (
      <View className="gap-2">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          Browser calling isn't connected yet on this deployment.
        </Text>
        <Pressable onPress={onCancel} hitSlop={6} className="self-start">
          <Text className="text-primary text-xs font-semibold">Back to calling by phone</Text>
        </Pressable>
      </View>
    );
  }

  if (call.phase === 'ready') {
    const preparing = !assistant;
    return (
      <View className="gap-3">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          We'll ask your browser for microphone access, then interview you right here — same
          questions, no phone call.
        </Text>
        {call.error ? (
          <Text className="text-red-500 dark:text-red-400 text-xs">{call.error}</Text>
        ) : null}
        <View className="flex-row gap-2">
          <Pressable
            onPress={handleCancel}
            className="flex-1 py-2.5 rounded-lg items-center border border-line dark:border-line-dk">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={call.start}
            disabled={preparing}
            className={`flex-1 py-2.5 rounded-lg items-center bg-primary ${preparing ? 'opacity-60' : ''}`}>
            {preparing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="font-semibold text-sm text-white">Allow &amp; start talking</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  if (call.phase === 'connecting') {
    return (
      <View className="gap-2 items-center py-2">
        <ActivityIndicator color={colors.primary} />
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">Connecting…</Text>
      </View>
    );
  }

  if (call.phase === 'live') {
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
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {call.speaking ? 'Speaking…' : 'Listening…'}
        </Text>
        <ScrollView className="max-h-40" showsVerticalScrollIndicator={false}>
          <View className="gap-2">
            {call.turns.map((t, i) => (
              <View
                key={i}
                className={`max-w-[86%] rounded-xl px-3 py-2 ${
                  t.role === 'user'
                    ? 'self-end bg-primary/10'
                    : 'self-start bg-white dark:bg-gray-800'
                }`}>
                <Text className="text-ink dark:text-ink-dk text-xs">{t.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Pressable
          onPress={call.end}
          className="flex-row items-center justify-center gap-2 py-2.5 rounded-lg bg-red-500">
          <Ionicons name="call" size={15} color="#FFFFFF" />
          <Text className="font-semibold text-sm text-white">End &amp; save</Text>
        </Pressable>
      </View>
    );
  }

  // call.phase === 'ended'
  if (submit.isError) {
    return (
      <View className="gap-2">
        <Text className="text-red-500 dark:text-red-400 text-sm">{prepError}</Text>
        <Pressable
          onPress={() => submit.mutate()}
          className="py-2.5 rounded-lg items-center bg-primary">
          <Text className="font-semibold text-sm text-white">Try saving again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="gap-2 items-center py-2">
      <ActivityIndicator color={colors.primary} />
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">Saving what you told it…</Text>
    </View>
  );
}
