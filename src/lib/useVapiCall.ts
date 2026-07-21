// Native-safe stand-in so tsc — which, unlike Metro, doesn't apply the
// .web.ts platform-suffix resolution — can typecheck TalkToAssistant.web.tsx
// and BrowserInterviewCall.web.tsx. Never actually runs: their native
// counterparts don't import this at all, and Metro resolves web bundles to
// useVapiCall.web.ts (the real @vapi-ai/web implementation) instead of this
// file.
import type { TranscriptTurn } from '@/lib/vapi-call';

export type VapiCallPhase = 'ready' | 'connecting' | 'live' | 'ended';

export type VapiAssistantConfig = Record<string, unknown>;

export function useVapiCall(_target: string | VapiAssistantConfig | null) {
  return {
    phase: 'ready' as VapiCallPhase,
    speaking: false,
    turns: [] as TranscriptTurn[],
    duration: 0,
    error: null as string | null,
    available: false,
    start: () => {},
    end: () => {},
    reset: () => {},
  };
}
