// Native fallback. See BrowserInterviewCall.web.tsx / TalkToAssistant.tsx for
// why: @vapi-ai/web is browser-only, so teaching the agent by talking stays a
// phone-call-only, desktop-first flow on native.
export type BrowserInterviewCallProps = {
  gymId: string;
  onCompleted: () => void;
  onCancel: () => void;
};

export function BrowserInterviewCall(_props: BrowserInterviewCallProps) {
  return null;
}
