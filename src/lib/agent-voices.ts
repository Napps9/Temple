export type AgentVoice = {
  id: string;
  provider: string;
  region: string;
  name: string;
  gender: string;
  desc: string;
};

// Curated, verified Azure Neural voices by region. provider + id are what the
// Vapi assistant is configured with; region is the display label. Shared by
// the AI-agent setup wizard and the automation settings screen.
export const AGENT_VOICES: AgentVoice[] = [
  { id: 'en-GB-SoniaNeural', provider: 'azure', region: 'UK, RP', name: 'Sonia', gender: 'Female', desc: 'Polished, neutral' },
  { id: 'en-GB-RyanNeural', provider: 'azure', region: 'UK, RP', name: 'Ryan', gender: 'Male', desc: 'Confident British' },
  { id: 'en-IE-EmilyNeural', provider: 'azure', region: 'Ireland', name: 'Emily', gender: 'Female', desc: 'Soft Dublin lilt' },
  { id: 'en-IE-ConnorNeural', provider: 'azure', region: 'Ireland', name: 'Connor', gender: 'Male', desc: 'Easygoing Irish' },
  { id: 'en-US-AriaNeural', provider: 'azure', region: 'US', name: 'Aria', gender: 'Female', desc: 'Bright American' },
  { id: 'en-US-GuyNeural', provider: 'azure', region: 'US', name: 'Guy', gender: 'Male', desc: 'Clean American' },
  { id: 'en-AU-NatashaNeural', provider: 'azure', region: 'Australia', name: 'Natasha', gender: 'Female', desc: 'Upbeat Australian' },
  { id: 'en-CA-LiamNeural', provider: 'azure', region: 'Canada', name: 'Liam', gender: 'Male', desc: 'Friendly Canadian' },
  { id: 'en-NZ-MollyNeural', provider: 'azure', region: 'New Zealand', name: 'Molly', gender: 'Female', desc: 'Warm Kiwi' },
  { id: 'en-ZA-LukeNeural', provider: 'azure', region: 'South Africa', name: 'Luke', gender: 'Male', desc: 'Crisp South African' },
];
