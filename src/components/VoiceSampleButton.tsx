import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type AudioLike = {
  play: () => Promise<void> | void;
  pause: () => void;
  addEventListener: (ev: string, fn: () => void) => void;
  removeEventListener: (ev: string, fn: () => void) => void;
};

// Sample URLs are per-voice and immutable once synthesised.
const urlCache = new Map<string, string | null>();
// One clip at a time across every button on the page.
let currentAudio: AudioLike | null = null;
let currentStop: (() => void) | null = null;

// Web-only, like call playback: RN ships no audio dependency, and picking a
// voice is an owner/desktop task. Renders nothing on native.
export function VoiceSampleButton({ voiceId }: { voiceId: string }) {
  const colors = useThemeColors();
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'unavailable'>('idle');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  async function resolveUrl(): Promise<string | null> {
    if (urlCache.has(voiceId)) return urlCache.get(voiceId) ?? null;
    const { data, error } = await supabase.functions.invoke('voice-sample', {
      body: { voice_id: voiceId },
    });
    const url = error ? null : ((data?.url as string | null) ?? null);
    urlCache.set(voiceId, url);
    return url;
  }

  async function toggle() {
    if (state === 'playing') {
      currentStop?.();
      return;
    }
    if (state === 'loading' || state === 'unavailable') return;
    setState('loading');
    const url = await resolveUrl();
    if (!mounted.current) return;
    if (!url) {
      setState('unavailable');
      return;
    }
    const A = (globalThis as unknown as { Audio?: new (src: string) => AudioLike }).Audio;
    if (!A) {
      setState('unavailable');
      return;
    }
    currentStop?.();
    const audio = new A(url);
    const stop = () => {
      audio.pause();
      audio.removeEventListener('ended', stop);
      if (currentAudio === audio) {
        currentAudio = null;
        currentStop = null;
      }
      if (mounted.current) setState('idle');
    };
    audio.addEventListener('ended', stop);
    currentAudio = audio;
    currentStop = stop;
    setState('playing');
    try {
      await audio.play();
    } catch {
      stop();
    }
  }

  if (state === 'unavailable') {
    return (
      <Ionicons
        name="volume-mute-outline"
        size={18}
        color={colors.iconTertiary}
        accessibilityLabel="No preview available"
      />
    );
  }
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={state === 'playing' ? 'Stop preview' : 'Play voice preview'}
      className="w-8 h-8 rounded-full items-center justify-center bg-primary/10">
      <Ionicons
        name={state === 'playing' ? 'stop' : state === 'loading' ? 'ellipsis-horizontal' : 'play'}
        size={15}
        color={colors.primary}
      />
    </Pressable>
  );
}
