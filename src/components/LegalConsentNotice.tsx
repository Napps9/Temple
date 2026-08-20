import { router } from 'expo-router';
import { Text } from './Text';

// Shown beneath account-creation actions so sign-up is an informed
// agreement to Temple's Terms and Privacy Policy. Inline tappable segments
// route to the public /terms and /privacy screens (reachable signed-out).
export function LegalConsentNotice() {
  return (
    <Text className="text-center text-xs text-ink-3 dark:text-ink-3-dk leading-5">
      By continuing you agree to Temple’s{' '}
      <Text
        className="text-[#3B6BA5] dark:text-[#6E97C6] underline"
        onPress={() => router.push('/terms' as never)}>
        Terms of Service
      </Text>{' '}
      and{' '}
      <Text
        className="text-[#3B6BA5] dark:text-[#6E97C6] underline"
        onPress={() => router.push('/privacy' as never)}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}
