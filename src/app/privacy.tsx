import { LegalDocScreen } from '@/components/LegalDocScreen';
import { PRIVACY_POLICY } from '@/lib/legal';

export default function PrivacyScreen() {
  return <LegalDocScreen doc={PRIVACY_POLICY} />;
}
