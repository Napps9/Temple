import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { errorMessage } from '@/lib/errors';
import {
  useRetentionRisk,
  useRetentionSummary,
  type RetentionRiskRow,
} from '@/lib/retention';
import { useCan } from '@/lib/useCan';

const REASON_LABEL: Record<string, string> = {
  past_due: 'Payment failed',
  expired: 'Membership lapsed',
  expiring_soon: 'Expiring soon',
  attendance_decay: 'Attendance drop',
  never_attended: 'Never attended',
};

// Chip colours are semantic (severity), separate from the brand accent.
const REASON_CHIP: Record<string, { bg: string; text: string }> = {
  past_due: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
  expired: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
  expiring_soon: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-800 dark:text-amber-300' },
  attendance_decay: { bg: 'bg-violet-100 dark:bg-violet-950', text: 'text-violet-700 dark:text-violet-300' },
  never_attended: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
};

const BAND_META: Record<
  RetentionRiskRow['risk_band'],
  { label: string; dot: string; text: string }
> = {
  critical: { label: 'Critical', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  at_risk: { label: 'At risk', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  watch: { label: 'Watch', dot: 'bg-primary', text: 'text-primary' },
};

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'No visits yet';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'critical' | 'warn' | 'violet' | 'primary';
}) {
  const bar = {
    critical: 'bg-red-500',
    warn: 'bg-amber-500',
    violet: 'bg-violet-500',
    primary: 'bg-primary',
  }[tone];
  return (
    <View className="flex-1 min-w-[140px] bg-white dark:bg-gray-900 rounded-xl overflow-hidden">
      <View className="flex-row">
        <View className={`w-1 ${bar}`} />
        <View className="flex-1 p-3">
          <Text className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
            {label}
          </Text>
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-bold mt-1">
            {value}
          </Text>
        </View>
      </View>
    </View>
  );
}

function RiskRow({ row }: { row: RetentionRiskRow }) {
  const band = BAND_META[row.risk_band];
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {row.full_name ?? 'Member'}
          </Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <View className={`w-2 h-2 rounded-full ${band.dot}`} />
            <Text className={`text-xs font-bold ${band.text}`}>{band.label}</Text>
            <Text className="text-gray-400 dark:text-gray-500 text-xs">
              · risk {row.risk_score}
            </Text>
          </View>
        </View>
        <Text className="text-gray-500 dark:text-gray-400 text-xs text-right">
          {lastSeenLabel(row.last_attended_at)}
          {row.days_until_expiry !== null && row.days_until_expiry >= 0
            ? `\nrenews in ${row.days_until_expiry}d`
            : ''}
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        {row.reasons.map((r) => {
          const chip = REASON_CHIP[r] ?? REASON_CHIP.never_attended;
          return (
            <View key={r} className={`rounded-full px-2 py-0.5 ${chip.bg}`}>
              <Text className={`text-[11px] font-semibold ${chip.text}`}>
                {REASON_LABEL[r] ?? r}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function RetentionScreen() {
  const canSeeRetention = useCan('can_see_retention');
  const summary = useRetentionSummary();
  const risk = useRetentionRisk();

  if (canSeeRetention === false) {
    return <Redirect href="/management" />;
  }

  const rows = risk.data ?? [];
  const s = summary.data;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Retention
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Members at risk of leaving, flagged from cohort, attendance and
            billing signals.
          </Text>
        </View>

        <View className="flex-row flex-wrap gap-3">
          <Tile label="At risk" value={s?.at_risk ?? 0} tone="critical" />
          <Tile label="Expiring" value={s?.expiring ?? 0} tone="warn" />
          <Tile label="Past due" value={s?.past_due ?? 0} tone="critical" />
          <Tile label="Win-back" value={s?.winback ?? 0} tone="violet" />
        </View>

        {risk.isLoading ? (
          <View className="py-10 items-center">
            <ActivityIndicator />
          </View>
        ) : risk.isError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(risk.error, 'Could not load at-risk members')}
          </Text>
        ) : rows.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-5 gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              No one's at risk right now
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              When a member's renewal approaches, a payment fails, or their
              attendance drops off, they'll show up here.
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {rows.map((row) => (
              <RiskRow key={row.member_id} row={row} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
