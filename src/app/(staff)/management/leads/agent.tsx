import { Redirect } from 'expo-router';

// The AI Agent tab became sections of Lead settings — see
// components/leads/AgentSettings.tsx for why. This is not a code shim:
// it is a URL that owners have bookmarked and pasted into Slack, and a
// 404 is a worse answer than a redirect. It can go once nothing reaches
// it, which record_route_open will say.
export default function LeadAgentRedirect() {
  return <Redirect href={'/management/leads/settings' as never} />;
}
