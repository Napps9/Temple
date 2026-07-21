// Web-only: @vapi-ai/web pulls in browser-only WebRTC internals, so this
// hook must only ever be imported from a .web.tsx entry point (TalkToAssistant
// and BrowserInterviewCall), which Metro's platform resolution already keeps
// out of the native bundle.
import { useEffect, useRef, useState } from 'react';
import Vapi from '@vapi-ai/web';

import { errorMessage } from '@/lib/errors';
import { finalTranscriptTurn, type TranscriptTurn } from '@/lib/vapi-call';

const VAPI_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPI_KEY;

export type VapiCallPhase = 'ready' | 'connecting' | 'live' | 'ended';

// A loose stand-in for @vapi-ai/web's CreateAssistantDTO — inline assistant
// configs built server-side and hosted directly through the browser SDK
// rather than referencing an assistant already persisted in Vapi.
export type VapiAssistantConfig = Record<string, unknown>;

// Runs a Vapi Web SDK call against either a persisted assistant (pass its id)
// or an inline config built for this call. Shared by TalkToAssistant ("talk
// to your own sales assistant") and BrowserInterviewCall ("teach it by
// talking" without a phone call) — same connect/live/transcript/end
// lifecycle, different assistant source.
export function useVapiCall(target: string | VapiAssistantConfig | null) {
  const [phase, setPhase] = useState<VapiCallPhase>('ready');
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<InstanceType<typeof Vapi> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const available = !!target && !!VAPI_PUBLIC_KEY;

  useEffect(
    () => () => {
      vapiRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  function start() {
    if (!available || !target) return;
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

    vapi.start(target as never).catch((e) => {
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
