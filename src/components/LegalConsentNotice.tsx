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
        className="text-ink-2 dark:text-ink-2-dk underline"
        onPress={() => router.push('/terms' as never)}>
        Terms of Service
      </Text>{' '}
      and{' '}
      <Text
        className="text-ink-2 dark:text-ink-2-dk underline"
        onPress={() => router.push('/privacy' as never)}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}
