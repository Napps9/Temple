export type AgentVoice = {
  id: string;
  provider: string;
  region: string;
  name: string;
  gender: string;
  desc: string;
};

// Curated ElevenLabs voices (Vapi provider "11labs"). provider + id are what the
// Vapi assistant is configured with; region is the display label and drives the
// "suggested for your gym" split in the setup wizard. Shared by the AI-agent
// setup wizard and the automation settings screen. The ids are ElevenLabs
// premade voice ids — Vapi renders them through its bundled ElevenLabs access.
export const AGENT_VOICES: AgentVoice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', provider: '11labs', region: 'UK, RP', name: 'George', gender: 'Male', desc: 'Warm, reassuring' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', provider: '11labs', region: 'UK, RP', name: 'Alice', gender: 'Female', desc: 'Clear, friendly' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', provider: '11labs', region: 'UK, RP', name: 'Lily', gender: 'Female', desc: 'Warm, natural' },
  { id: 'onwK4e9ZLuTAKqWW03F9', provider: '11labs', region: 'UK, RP', name: 'Daniel', gender: 'Male', desc: 'Calm, authoritative' },
  { id: '21m00Tcm4TlvDq8ikWAM', provider: '11labs', region: 'US', name: 'Rachel', gender: 'Female', desc: 'Calm, professional' },
  { id: 'nPczCjzI2devNBz1zQrb', provider: '11labs', region: 'US', name: 'Brian', gender: 'Male', desc: 'Deep, steady' },
  { id: 'IKne3meq5aSn9XLyUdCD', provider: '11labs', region: 'Australia', name: 'Charlie', gender: 'Male', desc: 'Relaxed, conversational' },
];
