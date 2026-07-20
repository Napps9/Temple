// Native fallback. @vapi-ai/web pulls in browser-only WebRTC internals
// (@daily-co/daily-js) that aren't safe to even import on native, so the
// real implementation lives in TalkToAssistant.web.tsx and Metro's
// platform-extension resolution picks it for web builds only — this file
// is what iOS/Android get instead. Talking to the assistant is an
// owner/desktop task (same call as VoiceSampleButton's audio previews),
// so native renders nothing rather than a broken button.
export type TalkToAssistantProps = {
  assistantId: string | null;
  gymName?: string;
  presentation?: 'inline' | 'docked';
  onRequestClose?: () => void;
};

export function TalkToAssistant(_props: TalkToAssistantProps) {
  return null;
}
