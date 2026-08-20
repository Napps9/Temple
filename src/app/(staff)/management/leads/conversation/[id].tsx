import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { syncVapiAssistant } from '@/lib/agent-sync';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { currencySymbol } from '@/lib/setup-flow';
import { useThemeColors } from '@/lib/theme';
import { useGymCurrency } from '@/lib/useGymCurrency';

type Conversation = {
  id: string;
  gym_id: string;
  phone: string;
  channel: 'sms' | 'voice';
  status: 'active' | 'handed_off' | 'closed';
  lead: { id: string; full_name: string } | null;
};

type MessageRow = {
  id: string;
  role: 'lead' | 'agent' | 'staff' | 'system';
  body: string;
  created_at: string;
  seconds_from_start: number | null;
  duration_ms: number | null;
};

type Recording = { id: string; recording_path: string; duration_seconds: number | null };

type CoachKind = 'fact' | 'tone' | 'rule' | 'exemplar';
type CoachScope = 'standing_rule' | 'example';

const KIND_LABEL: Record<CoachKind, { label: string; hint: string }> = {
  fact: { label: 'Fix the facts', hint: 'Wrong price or detail' },
  tone: { label: 'Fix the tone', hint: 'Too pushy / passive / wordy' },
  rule: { label: 'Add a standing rule', hint: 'Always / never do this' },
  exemplar: { label: 'This was good', hint: 'Save as an example' },
};

const MESSAGE_ID_PREFIX = 'msg-';

// Walks up from a selection's anchor node to the nearest bubble carrying
// a `msg-<id>` nativeID (set on the agent Pressable below — nativeID is
// the one RN prop guaranteed to become a real DOM id on web, unlike
// react-native-web's untyped dataSet extension). Web only, DOM nodes
// don't exist on native.
function closestMessageId(node: Node | null): string | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el) {
    if (el.id?.startsWith(MESSAGE_ID_PREFIX)) return el.id.slice(MESSAGE_ID_PREFIX.length);
    el = el.parentElement;
  }
  return null;
}

function fmtClock(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${`0${t % 60}`.slice(-2)}`;
}

// Wall-clock timestamp for a staff-sent SMS — unlike call turns these
// aren't seconds-from-call-start, so they need a real date/time, not fmtClock.
function fmtSmsTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ScrubBar({
  current,
  duration,
  onSeek,
}: {
  current: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const frac = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
  return (
    <Pressable
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={(e) => {
        // react-native-web hands onPress a DOM MouseEvent, which has no
        // locationX — offsetX is the web equivalent (same left origin for
        // the pressable, the track, and the fill, so it maps directly).
        const ne = e.nativeEvent as unknown as { locationX?: number; offsetX?: number };
        const x = typeof ne.locationX === 'number' ? ne.locationX : ne.offsetX;
        if (typeof x !== 'number' || width <= 0 || duration <= 0) return;
        onSeek(Math.max(0, Math.min(duration, (x / width) * duration)));
      }}
      accessibilityLabel="Seek within the recording"
      // Tall hit target around a thin track — a 6px bar is miserable to tap.
      className="flex-1 h-8 justify-center">
      <View className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <View className="h-full bg-primary" style={{ width: `${frac * 100}%` }} />
      </View>
    </Pressable>
  );
}

type AudioLike = {
  currentTime: number;
  duration: number;
  paused: boolean;
  play(): void;
  pause(): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
};

// Web-only <audio> playback. RN has no built-in audio and the app ships no
// audio dependency; call review is an owner/desktop task, so we drive an
// HTMLAudioElement on web and degrade to transcript-only on native. The
// element is reached through the global so the shared build needs no DOM lib.
function useWebAudio(url: string | null) {
  const ref = useRef<AudioLike | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const supported = Platform.OS === 'web' && !!url;

  useEffect(() => {
    if (!supported || !url) return;
    const A = (globalThis as unknown as { Audio?: new (src: string) => AudioLike }).Audio;
    if (!A) return;
    const audio = new A(url);
    ref.current = audio;
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      ref.current = null;
    };
  }, [supported, url]);

  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };
  const seek = (t: number) => {
    const audio = ref.current;
    if (!audio) return;
    audio.currentTime = t;
    setCurrentTime(t);
  };

  return { supported, playing, currentTime, duration, toggle, seek };
}

export default function AgentConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canWorkLeads = useCan('can_work_leads');
  const canReview = useCan('can_review_ai_calls');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [coachFor, setCoachFor] = useState<MessageRow | null>(null);
  const [coachedIds, setCoachedIds] = useState<Set<string>>(new Set());
  // Highlight-to-comment (web only): drag a phrase inside an agent bubble
  // to flag just that excerpt, instead of coaching the whole turn.
  const [selectedText, setSelectedText] = useState<{ messageId: string; text: string } | null>(
    null,
  );
  const [inlineCoachFor, setInlineCoachFor] = useState<MessageRow | null>(null);
  const transcriptRef = useRef<View>(null);

  const conversation = useQuery({
    queryKey: ['agent-conversation', id],
    enabled: !!id && canWorkLeads === true,
    queryFn: async (): Promise<Conversation | null> => {
      const { data, error: e } = await supabase
        .from('agent_conversations')
        .select('id, gym_id, phone, channel, status, lead:leads!lead_id(id, full_name)')
        .eq('id', id!)
        .maybeSingle();
      if (e) throw e;
      return (data as unknown as Conversation) ?? null;
    },
  });

  const messages = useQuery({
    queryKey: ['agent-messages', id],
    enabled: !!id && canWorkLeads === true,
    refetchInterval: 5000,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error: e } = await supabase
        .from('agent_messages')
        .select('id, role, body, created_at, seconds_from_start, duration_ms')
        .eq('conversation_id', id!)
        .order('created_at', { ascending: true })
        .limit(300);
      if (e) throw e;
      return (data ?? []) as MessageRow[];
    },
  });

  const isVoice = conversation.data?.channel === 'voice';

  const recording = useQuery({
    queryKey: ['agent-recording', id],
    enabled: !!id && isVoice && canReview === true,
    queryFn: async (): Promise<Recording | null> => {
      const { data, error: e } = await supabase
        .from('call_recordings')
        .select('id, recording_path, duration_seconds')
        .eq('conversation_id', id!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e) throw e;
      return (data as Recording) ?? null;
    },
  });

  const signedUrl = useQuery({
    queryKey: ['agent-recording-url', recording.data?.id],
    enabled: !!recording.data?.recording_path,
    // Signed URLs are short-lived; refetch before they lapse.
    staleTime: 45 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error: e } = await supabase.storage
        .from('agent-call-recordings')
        .createSignedUrl(recording.data!.recording_path, 3600);
      if (e) throw e;
      return data?.signedUrl ?? null;
    },
  });

  // Audit every time a recording is actually opened for playback.
  const loggedRef = useRef<string | null>(null);
  useEffect(() => {
    const rec = recording.data;
    const gymId = conversation.data?.gym_id;
    if (!rec || !gymId || !signedUrl.data) return;
    if (loggedRef.current === rec.id) return;
    loggedRef.current = rec.id;
    supabase.rpc('log_recording_access', {
      p_gym_id: gymId,
      p_recording: rec.id,
      p_surface: 'call-review',
    });
  }, [recording.data, conversation.data?.gym_id, signedUrl.data]);

  const audio = useWebAudio(signedUrl.data ?? null);
  // Read via a ref inside the selectionchange listener below so that
  // listener doesn't need to be torn down and re-attached every render
  // just because useWebAudio returns a new object each time.
  const audioRef = useRef(audio);
  audioRef.current = audio;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    function onSelectionChange() {
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? '';
      const container = transcriptRef.current as unknown as HTMLElement | null;
      if (
        !sel ||
        sel.isCollapsed ||
        !text ||
        !container ||
        !sel.anchorNode ||
        !sel.focusNode ||
        !container.contains(sel.anchorNode) ||
        !container.contains(sel.focusNode)
      ) {
        setSelectedText(null);
        return;
      }
      const messageId = closestMessageId(sel.anchorNode);
      if (!messageId || messageId !== closestMessageId(sel.focusNode)) {
        // No bubble found, or the drag crossed between two bubbles —
        // only single-turn excerpts are supported.
        setSelectedText(null);
        return;
      }
      setSelectedText({ messageId, text });
      if (audioRef.current.playing) audioRef.current.toggle();
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const timed = useMemo(
    () => (messages.data ?? []).filter((m) => m.seconds_from_start != null),
    [messages.data],
  );
  const activeId = useMemo(() => {
    if (!isVoice || timed.length === 0) return null;
    let active: string | null = null;
    for (const m of timed) {
      if ((m.seconds_from_start ?? 0) <= audio.currentTime + 0.001) active = m.id;
    }
    return active;
  }, [isVoice, timed, audio.currentTime]);

  const act = useMutation({
    mutationFn: async (payload: {
      action: 'take_over' | 'send' | 'reopen';
      body?: string;
    }) => {
      const { data, error: e } = await supabase.functions.invoke('lead-agent-staff-send', {
        body: { conversation_id: id, ...payload },
      });
      if (e) throw e;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: (_data, payload) => {
      setError(null);
      if (payload.action === 'send') setDraft('');
      queryClient.invalidateQueries({ queryKey: ['agent-conversation', id] });
      queryClient.invalidateQueries({ queryKey: ['agent-messages', id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not update the conversation')),
  });

  if (canWorkLeads === false) return <Redirect href="/management" />;
  if (!membership) return null;

  const c = conversation.data;
  const status = c?.status;
  const rows = messages.data ?? [];
  // Staff's own follow-up texts land in this same conversation's messages
  // (see lead-agent-staff-send) alongside the call's spoken turns — split
  // them out so the recorded call and any SMS sent from here read as two
  // distinct things instead of one confusing mixed thread. Only meaningful
  // for a voice conversation; an SMS-channel conversation is SMS start to
  // finish, so it keeps the single unified thread.
  const transcriptRows = rows.filter((m) => m.role !== 'staff');
  const smsRows = rows.filter((m) => m.role === 'staff');

  const replyBox =
    c && status !== 'closed' ? (
      <>
        <Input
          label="Reply as staff"
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="Texts the lead from your gym's number and pauses the AI"
        />
        <Button
          onPress={() => act.mutate({ action: 'send', body: draft })}
          loading={act.isPending}
          disabled={!draft.trim()}>
          Send text
        </Button>
      </>
    ) : null;
  const closedText =
    c && status === 'closed' ? (
      <Text className="text-gray-500 dark:text-gray-400 text-sm">
        This person replied STOP, so the thread is closed and no more texts can be
        sent.
      </Text>
    ) : null;

  function renderBubble(m: MessageRow) {
    if (m.role === 'system') {
      return (
        <View key={m.id} className="px-4 py-2">
          <Text className="text-gray-400 dark:text-gray-500 text-xs italic">
            {m.body}
          </Text>
        </View>
      );
    }
    const fromLead = m.role === 'lead';
    const isAgent = m.role === 'agent';
    const active = m.id === activeId;
    const seekable = audio.supported && m.seconds_from_start != null;
    return (
      <View key={m.id} className={`gap-1 ${fromLead ? 'items-start' : 'items-end'}`}>
        <Pressable
          disabled={!seekable}
          onPress={() => seekable && audio.seek(m.seconds_from_start ?? 0)}
          // nativeID -> DOM id, so the web-only selection listener
          // can tell which turn a highlighted phrase is in.
          nativeID={isAgent ? `${MESSAGE_ID_PREFIX}${m.id}` : undefined}
          className={`max-w-[88%] rounded-xl px-3 py-2 ${
            fromLead ? 'self-start bg-gray-200 dark:bg-gray-800' : 'self-end bg-primary/10'
          } ${active ? 'border border-primary' : 'border border-transparent'}`}>
          <Text className="text-gray-900 dark:text-gray-50">{m.body}</Text>
          <View className="flex-row items-center justify-between mt-1 gap-3">
            <Text className="text-gray-400 dark:text-gray-500 text-[10px]">
              {m.role === 'agent' ? 'AI' : m.role === 'staff' ? 'Staff' : 'Lead'}
              {m.seconds_from_start != null ? ` · ${fmtClock(m.seconds_from_start)}` : ''}
            </Text>
            {isAgent && canReview === true ? (
              <Pressable
                onPress={() => setCoachFor(m)}
                hitSlop={6}
                className="flex-row items-center gap-1">
                <Ionicons name="school-outline" size={12} color={colors.primary} />
                <Text className="text-primary text-[11px] font-semibold">Coach</Text>
              </Pressable>
            ) : null}
          </View>
          {isAgent && coachedIds.has(m.id) ? (
            <View className="flex-row items-center gap-1 mt-1">
              <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
              <Text className="text-green-600 dark:text-green-400 text-[11px] font-semibold">
                Coached — applies to future calls
              </Text>
            </View>
          ) : null}
        </Pressable>

        {isAgent &&
        canReview === true &&
        Platform.OS === 'web' &&
        selectedText?.messageId === m.id &&
        inlineCoachFor?.id !== m.id ? (
          // Raw <div>, not <Pressable>: clicking this chip is itself a click
          // "outside" the active selection, so the browser's default
          // mousedown behavior collapses it before the click completes —
          // that reactively nulls selectedText, which unmounts this chip
          // (its own visibility is keyed off that same selection) before
          // onPress ever fires. preventDefault on mousedown is the standard
          // fix (same technique already used for the site-builder toolbar
          // in site-render.ts) and needs the raw DOM event Pressable
          // doesn't expose a typed prop for.
          <div
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setInlineCoachFor(m);
              window.getSelection()?.removeAllRanges();
            }}
            className="flex-row items-center gap-1 bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1 cursor-pointer"
            style={{ display: 'flex', alignItems: 'center' }}>
            <Ionicons name="chatbox-ellipses-outline" size={11} color={colors.primary} />
            <Text className="text-primary text-[11px] font-semibold">
              Comment on "{selectedText.text.length > 40 ? `${selectedText.text.slice(0, 40)}…` : selectedText.text}"
            </Text>
          </div>
        ) : null}

        {isAgent && inlineCoachFor?.id === m.id ? (
          <InlineCoachForm
            message={m}
            excerpt={selectedText?.messageId === m.id ? selectedText.text : m.body}
            gymId={conversation.data?.gym_id ?? null}
            conversationId={id ?? null}
            onClose={() => setInlineCoachFor(null)}
            onCoached={(mid) => {
              setCoachedIds((s) => new Set(s).add(mid));
              setInlineCoachFor(null);
              setSelectedText(null);
              queryClient.invalidateQueries({ queryKey: ['agent-rules', conversation.data?.gym_id] });
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/leads/conversations" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            {c?.lead?.full_name ?? c?.phone ?? 'Conversation'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {c
              ? `${isVoice ? 'Phone call' : 'SMS'} · ${c.phone} · ${
                  status === 'active'
                    ? 'AI replying'
                    : status === 'handed_off'
                      ? 'With a coach'
                      : 'Opted out'
                }`
              : ''}
          </Text>
        </View>

        {/* Recording playback (voice, reviewers only) */}
        {isVoice && canReview === true && recording.data ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              Call recording
            </Text>
            {audio.supported ? (
              <>
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={audio.toggle}
                    accessibilityLabel={audio.playing ? 'Pause' : 'Play'}
                    className="w-12 h-12 rounded-full bg-primary items-center justify-center">
                    <Ionicons
                      name={audio.playing ? 'pause' : 'play'}
                      size={22}
                      color="#FFFFFF"
                    />
                  </Pressable>
                  <ScrubBar
                    current={audio.currentTime}
                    duration={audio.duration || recording.data.duration_seconds || 0}
                    onSeek={audio.seek}
                  />
                  <Text
                    className="text-gray-600 dark:text-gray-300 text-xs"
                    style={{ fontVariant: ['tabular-nums'] }}>
                    {fmtClock(audio.currentTime)} /{' '}
                    {fmtClock(audio.duration || recording.data.duration_seconds || 0)}
                  </Text>
                </View>
                <Text className="text-gray-400 dark:text-gray-500 text-xs">
                  The transcript follows the audio — tap a line to jump, or drag
                  across a phrase in an AI reply to coach just that part.
                </Text>
              </>
            ) : (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Open this call on the web app to play the recording. The transcript is
                below either way.
              </Text>
            )}
          </View>
        ) : null}

        {c && status !== 'closed' ? (
          <View className="flex-row gap-2">
            {status === 'active' ? (
              <ChipButton
                label="Take over"
                icon="hand-left-outline"
                tone="amber"
                onPress={() => act.mutate({ action: 'take_over' })}
              />
            ) : (
              <ChipButton
                label="Hand back to AI"
                icon="sparkles-outline"
                tone="primary"
                onPress={() => act.mutate({ action: 'reopen' })}
              />
            )}
          </View>
        ) : null}

        {isVoice ? (
          <>
            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                Call transcript
              </Text>
              <View className="gap-2" ref={transcriptRef}>
                {transcriptRows.map(renderBubble)}
                {messages.isSuccess && transcriptRows.length === 0 ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-center py-6">
                    No call transcript yet.
                  </Text>
                ) : null}
              </View>
            </View>

            <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
                SMS
              </Text>
              {smsRows.length > 0 ? (
                <View className="gap-2">
                  {smsRows.map((m) => (
                    <View key={m.id} className="items-end">
                      <View className="max-w-[88%] rounded-xl px-3 py-2 bg-primary/10">
                        <Text className="text-gray-900 dark:text-gray-50">{m.body}</Text>
                        <Text className="text-gray-400 dark:text-gray-500 text-[10px] mt-1">
                          Staff · {fmtSmsTime(m.created_at)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {replyBox}
              {closedText}
            </View>
          </>
        ) : (
          <>
            <View className="gap-2" ref={transcriptRef}>
              {rows.map(renderBubble)}
              {messages.isSuccess && rows.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-center py-6">
                  No messages yet.
                </Text>
              ) : null}
            </View>

            {c && status !== 'closed' ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
                {replyBox}
              </View>
            ) : null}
            {closedText}
          </>
        )}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
      </ScrollView>

      <CoachModal
        message={coachFor}
        priorLead={priorLeadBody(rows, coachFor)}
        gymId={c?.gym_id ?? null}
        conversationId={id ?? null}
        onClose={() => setCoachFor(null)}
        onCoached={(mid) => {
          setCoachedIds((s) => new Set(s).add(mid));
          queryClient.invalidateQueries({ queryKey: ['agent-rules', c?.gym_id] });
          setCoachFor(null);
        }}
      />
    </Screen>
  );
}

function priorLeadBody(rows: MessageRow[], target: MessageRow | null): string | null {
  if (!target) return null;
  const idx = rows.findIndex((r) => r.id === target.id);
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (rows[i].role === 'lead') return rows[i].body;
  }
  return null;
}

function CoachModal({
  message,
  priorLead,
  gymId,
  conversationId,
  onClose,
  onCoached,
}: {
  message: MessageRow | null;
  priorLead: string | null;
  gymId: string | null;
  conversationId: string | null;
  onClose: () => void;
  onCoached: (messageId: string) => void;
}) {
  const symbol = currencySymbol(useGymCurrency());
  const [kind, setKind] = useState<CoachKind>('rule');
  const [scope, setScope] = useState<CoachScope>('standing_rule');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setKind('rule');
      setScope('standing_rule');
      setText('');
      setError(null);
    }
  }, [message]);

  const deploy = useMutation({
    mutationFn: async () => {
      if (!gymId || !message) throw new Error('Missing context');
      if (!text.trim()) throw new Error('Add a correction');
      const { error: e } = await supabase.rpc('record_agent_corrections', {
        p_gym_id: gymId,
        p_rows: [
          {
            field_kind: kind,
            scope: kind === 'exemplar' ? 'example' : scope,
            correction: text.trim(),
            ai_suggestion: message.body,
            conversation_id: conversationId,
            message_id: message.id,
            input_payload: priorLead ? { caller: priorLead } : null,
            was_overridden: kind !== 'exemplar',
          },
        ],
      });
      if (e) throw e;
      await syncVapiAssistant(gymId);
    },
    onSuccess: () => message && onCoached(message.id),
    onError: (e) => setError(errorMessage(e, 'Could not save the correction')),
  });

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/50 items-center justify-center p-4">
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5 gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
            Coach this turn
          </Text>
          <View className="gap-1">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              The AI said
            </Text>
            <View className="bg-primary/10 rounded-lg p-3">
              <Text className="text-gray-800 dark:text-gray-100 text-sm">
                {message?.body}
              </Text>
            </View>
          </View>

          <View className="gap-1.5">
            <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
              What needs to change?
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(['fact', 'tone', 'rule', 'exemplar'] as CoachKind[]).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  className={`px-3 py-1.5 rounded-full border ${
                    kind === k
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={`text-xs font-semibold ${
                      kind === k ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                    }`}>
                    {KIND_LABEL[k].label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              {KIND_LABEL[kind].hint}
            </Text>
          </View>

          <Input
            label="Your correction"
            value={text}
            onChangeText={setText}
            multiline
            placeholder={
              kind === 'exemplar'
                ? 'Note why this was a good reply'
                : `e.g. Membership is ${symbol}45/mo — never quote ${symbol}39 as the monthly rate`
            }
          />

          {kind !== 'exemplar' ? (
            <View className="flex-row gap-2">
              {(
                [
                  ['standing_rule', 'Standing rule — every call'],
                  ['example', 'Just this style of reply'],
                ] as [CoachScope, string][]
              ).map(([s, label]) => (
                <Pressable
                  key={s}
                  onPress={() => setScope(s)}
                  className={`flex-1 px-3 py-2 rounded-lg border ${
                    scope === s
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={`text-xs font-semibold ${
                      scope === s ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                    }`}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
          ) : null}

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button variant="ghost" onPress={onClose}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button onPress={() => deploy.mutate()} loading={deploy.isPending}>
                Deploy to agent
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// The highlight-to-comment counterpart to CoachModal above: same fields
// and the same record_agent_corrections call, but anchored inline under
// the exact phrase that was flagged (ai_suggestion = the excerpt, not
// the whole message) instead of a centered modal over the transcript.
function InlineCoachForm({
  message,
  excerpt,
  gymId,
  conversationId,
  onClose,
  onCoached,
}: {
  message: MessageRow;
  excerpt: string;
  gymId: string | null;
  conversationId: string | null;
  onClose: () => void;
  onCoached: (messageId: string) => void;
}) {
  const [kind, setKind] = useState<CoachKind>('fact');
  const [scope, setScope] = useState<CoachScope>('standing_rule');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const deploy = useMutation({
    mutationFn: async () => {
      if (!gymId) throw new Error('Missing context');
      if (!text.trim()) throw new Error('Add a correction');
      const { error: e } = await supabase.rpc('record_agent_corrections', {
        p_gym_id: gymId,
        p_rows: [
          {
            field_kind: kind,
            scope: kind === 'exemplar' ? 'example' : scope,
            correction: text.trim(),
            ai_suggestion: excerpt,
            conversation_id: conversationId,
            message_id: message.id,
            input_payload: null,
            was_overridden: kind !== 'exemplar',
          },
        ],
      });
      if (e) throw e;
      await syncVapiAssistant(gymId);
    },
    onSuccess: () => onCoached(message.id),
    onError: (e) => setError(errorMessage(e, 'Could not save the correction')),
  });

  return (
    <View className="w-full max-w-[86%] bg-white dark:bg-gray-900 rounded-xl p-3 gap-2.5 shadow-card border border-primary/20">
      <View className="bg-primary/5 rounded-lg px-3 py-2 border-l-2 border-primary">
        <Text className="text-gray-600 dark:text-gray-300 text-xs italic">"{excerpt}"</Text>
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        {(['fact', 'tone', 'rule', 'exemplar'] as CoachKind[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            className={`px-2.5 py-1 rounded-full border ${
              kind === k ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
            }`}>
            <Text
              className={`text-[11px] font-semibold ${
                kind === k ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
              }`}>
              {KIND_LABEL[k].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Input
        label="Your correction"
        value={text}
        onChangeText={setText}
        multiline
        placeholder={
          kind === 'exemplar' ? 'Note why this was a good reply' : 'What should it say instead?'
        }
      />

      {kind !== 'exemplar' ? (
        <View className="flex-row gap-2">
          {(
            [
              ['standing_rule', 'Standing rule'],
              ['example', 'Just this style'],
            ] as [CoachScope, string][]
          ).map(([s, label]) => (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              className={`flex-1 px-2.5 py-1.5 rounded-lg border ${
                scope === s ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={`text-[11px] font-semibold text-center ${
                  scope === s ? 'text-primary' : 'text-gray-600 dark:text-gray-300'
                }`}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
        </View>
        <View className="flex-1">
          <Button onPress={() => deploy.mutate()} loading={deploy.isPending}>
            Deploy to agent
          </Button>
        </View>
      </View>
    </View>
  );
}
