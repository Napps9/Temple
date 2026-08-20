import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import type { DnsRecordDisplay, StatusTone } from '@/lib/domain-utils';

// Shared presentational pieces for the two domain-connection cards
// (SendingDomainCard for email, CustomDomainCard for the website).
// Each card keeps its own status-helper module — StatusBadge and
// StatusExplainer take the already-resolved {label, tone} / text rather
// than a status enum, so this file stays provider-agnostic.

export const TONE: Record<StatusTone, { bg: string; text: string }> = {
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  green: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
};

// Returns whether the value actually reached the clipboard — the
// checkmark must not flash on native, where there's no clipboard API
// wired up and a false success would send someone to their registrar
// with stale paste content.
function copyToClipboard(text: string): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function StatusBadge({ meta }: { meta: { label: string; tone: StatusTone } }) {
  const tone = TONE[meta.tone];
  return (
    <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
      <Text className={`text-[11px] font-semibold ${tone.text}`}>{meta.label}</Text>
    </View>
  );
}

// Plain-language "here's what's happening / what to do" for the current
// status, colour-matched to the badge.
export function StatusExplainer({ tone, text }: { tone: StatusTone; text: string }) {
  const t = TONE[tone];
  return (
    <View className={`rounded-lg p-3 ${t.bg}`}>
      <Text className={`text-xs leading-5 ${t.text}`}>{text}</Text>
    </View>
  );
}

export function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function onCopy() {
    if (!copyToClipboard(value)) return;
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
        {Platform.OS === 'web' ? (
          <Pressable onPress={onCopy} hitSlop={6} className="active:opacity-70">
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={15}
              color={copied ? '#16A34A' : '#9CA3AF'}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function RecordCard({ record }: { record: DnsRecordDisplay }) {
  const heading = record.record || record.type || 'DNS record';
  return (
    <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Text className="text-gray-900 dark:text-gray-50 text-xs font-semibold">
          {heading}
        </Text>
        {record.type ? (
          <View className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
            <Text className="text-gray-600 dark:text-gray-300 text-[10px] font-medium">
              {record.type}
            </Text>
          </View>
        ) : null}
        {record.priority != null ? (
          <Text className="text-gray-400 text-[10px]">priority {record.priority}</Text>
        ) : null}
      </View>
      {record.name ? <CopyableValue label="Host / name" value={record.name} /> : null}
      {record.value ? <CopyableValue label="Value" value={record.value} /> : null}
      {record.note ? (
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] leading-4">
          {record.note}
        </Text>
      ) : null}
    </View>
  );
}
