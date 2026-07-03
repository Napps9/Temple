import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { useCustomDomain, useCustomDomainAction } from '@/lib/custom-domain';
import {
  domainStatusDescription,
  domainStatusMeta,
  validateCustomDomain,
  type DnsRecord,
  type CustomDomainStatus,
  type StatusTone,
} from '@/lib/site-domain';

const TONE: Record<StatusTone, { bg: string; text: string }> = {
  gray: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  green: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
};

function copy(text: string) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(text);
  }
}

function StatusBadge({ status }: { status: CustomDomainStatus }) {
  const meta = domainStatusMeta(status);
  const tone = TONE[meta.tone];
  return (
    <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
      <Text className={`text-[11px] font-semibold ${tone.text}`}>{meta.label}</Text>
    </View>
  );
}

// Prefers the row's own error_message: the generic 'error' copy tells
// the gym to re-check DNS, which would mislead when the real problem is
// e.g. the domain no longer being attached at all.
function StatusExplainer({
  status,
  errorMessage,
}: {
  status: CustomDomainStatus;
  errorMessage?: string | null;
}) {
  const tone = TONE[domainStatusMeta(status).tone];
  return (
    <View className={`rounded-lg p-3 ${tone.bg}`}>
      <Text className={`text-xs leading-5 ${tone.text}`}>
        {errorMessage ?? domainStatusDescription(status)}
      </Text>
    </View>
  );
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function onCopy() {
    copy(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <View className="gap-1">
      <Text className="text-gray-400 dark:text-gray-500 text-[11px] uppercase tracking-wide">
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        <Text
          selectable
          className="flex-1 text-gray-800 dark:text-gray-100 text-xs font-mono break-all"
          style={Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as object) : undefined}>
          {value}
        </Text>
        <Pressable onPress={onCopy} hitSlop={6} className="active:opacity-70">
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={15}
            color={copied ? '#16A34A' : '#9CA3AF'}
          />
        </Pressable>
      </View>
    </View>
  );
}

function RecordCard({ record }: { record: DnsRecord }) {
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-2">
      <View className="flex-row items-center gap-2">
        <View className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
          <Text className="text-gray-600 dark:text-gray-300 text-[10px] font-medium">
            {record.type}
          </Text>
        </View>
        {record.priority != null ? (
          <Text className="text-gray-400 text-[10px]">priority {record.priority}</Text>
        ) : null}
      </View>
      <CopyableValue label="Host / name" value={record.name} />
      <CopyableValue label="Value" value={record.value} />
      {record.note ? (
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] leading-4">
          {record.note}
        </Text>
      ) : null}
    </View>
  );
}

export function CustomDomainCard({ gymId }: { gymId: string | null | undefined }) {
  const query = useCustomDomain(gymId);
  const action = useCustomDomainAction(gymId);

  const [domainInput, setDomainInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<{ tone: 'amber' | 'red'; text: string } | null>(
    null,
  );

  const domain = query.data;
  const records = (domain?.records as unknown as DnsRecord[] | null) ?? [];
  const actionError = action.isError ? action.error.message : null;

  function connect() {
    setFormError(null);
    const d = validateCustomDomain(domainInput);
    if (!d.ok) return setFormError(d.error);
    action.mutate({ action: 'connect', domain: d.domain });
  }

  // A plain success is silent (the card flips to Verified); anything else
  // says precisely what the gym is still waiting on, so a click never
  // feels like a no-op.
  function verify() {
    setVerifyNote(null);
    action.mutate(
      { action: 'verify' },
      {
        onSuccess: (data) => {
          if (data.status === 'verified') return;
          if (data.status === 'error') {
            setVerifyNote({
              tone: 'red',
              text:
                data.error_message ??
                'Something is wrong with this domain — disconnect it and connect it again.',
            });
          } else if (data.ownership_verified === false) {
            setVerifyNote({
              tone: 'amber',
              text: 'Not verified yet — we’re still waiting on the TXT ownership record. Add it exactly as shown, give DNS a few minutes, then check again.',
            });
          } else {
            setVerifyNote({
              tone: 'amber',
              text: 'Not live yet — your DNS changes haven’t propagated. This can take a few minutes (occasionally up to 48h). Leave the records in place and check again shortly.',
            });
          }
        },
      },
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Custom domain
        </Text>
        {domain ? <StatusBadge status={domain.status} /> : null}
      </View>
      {domain ? (
        <StatusExplainer status={domain.status} errorMessage={domain.error_message} />
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">
          Connect a domain you own so your site serves from it directly, instead of only
          at /site/&lt;your-slug&gt;.
        </Text>
      )}

      {query.isLoading ? (
        <ActivityIndicator />
      ) : !domain ? (
        <View className="gap-3">
          <Input
            label="Domain"
            value={domainInput}
            onChangeText={setDomainInput}
            autoCapitalize="none"
            placeholder="www.yourgym.com"
          />
          {formError ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{formError}</Text>
          ) : null}
          <Button onPress={connect} loading={action.isPending}>
            Connect domain
          </Button>
        </View>
      ) : domain.status === 'verified' ? (
        <View className="gap-3">
          <View className="flex-row items-center gap-2 bg-green-500/10 rounded-lg p-3">
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                Live at
              </Text>
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-mono">
                {domain.domain}
              </Text>
            </View>
          </View>
          <View className="self-start">
            <ChipButton
              tone="red"
              label="Disconnect domain"
              icon="close-circle-outline"
              onPress={() => action.mutate({ action: 'disconnect' })}
              disabled={action.isPending}
            />
          </View>
        </View>
      ) : (
        <View className="gap-3">
          {/* In the 'error' state the records are noise — the explainer
              above already says the real fix (disconnect and reconnect). */}
          {domain.status !== 'error' ? (
            <>
              <Text className="text-gray-700 dark:text-gray-200 text-sm">
                Add these records at the registrar for{' '}
                <Text className="font-mono">{domain.domain}</Text>.
              </Text>

              {records.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  No records returned yet — try verifying.
                </Text>
              ) : (
                <View className="gap-2">
                  {records.map((r, i) => (
                    <RecordCard key={`${r.type}-${r.name}-${i}`} record={r} />
                  ))}
                </View>
              )}
            </>
          ) : null}

          {verifyNote ? (
            <View
              className={`rounded-lg p-3 ${
                verifyNote.tone === 'red' ? 'bg-red-500/10' : 'bg-amber-500/10'
              }`}>
              <Text
                className={`text-xs ${
                  verifyNote.tone === 'red'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}>
                {verifyNote.text}
              </Text>
            </View>
          ) : null}

          <Button onPress={verify} loading={action.isPending}>
            I’ve added the records — verify
          </Button>
          <View className="self-start">
            <ChipButton
              tone="red"
              label="Disconnect domain"
              icon="close-circle-outline"
              onPress={() => action.mutate({ action: 'disconnect' })}
              disabled={action.isPending}
            />
          </View>
        </View>
      )}

      {actionError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{actionError}</Text>
      ) : null}
    </View>
  );
}
