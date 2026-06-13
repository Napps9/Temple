import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useThemeColors } from '@/lib/theme';
import { useSendingDomain, useSendingDomainAction } from '@/lib/comms';
import {
  domainStatusMeta,
  fromAddress,
  validateLocalPart,
  validateSendingDomain,
  type DnsRecord,
  type DomainStatus,
  type StatusTone,
} from '@/lib/sending-domain';

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

function StatusBadge({ status }: { status: DomainStatus }) {
  const meta = domainStatusMeta(status);
  const tone = TONE[meta.tone];
  return (
    <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
      <Text className={`text-[11px] font-semibold ${tone.text}`}>{meta.label}</Text>
    </View>
  );
}

function CopyableValue({ label, value }: { label: string; value: string }) {
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
        <Pressable onPress={() => copy(value)} hitSlop={6} className="active:opacity-70">
          <Ionicons name="copy-outline" size={15} color="#9CA3AF" />
        </Pressable>
      </View>
    </View>
  );
}

function RecordCard({ record }: { record: DnsRecord }) {
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
    </View>
  );
}

export function SendingDomainCard() {
  const colors = useThemeColors();
  const query = useSendingDomain();
  const action = useSendingDomainAction();

  const [domainInput, setDomainInput] = useState('');
  const [fromLocal, setFromLocal] = useState('news');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingLocal, setEditingLocal] = useState(false);
  const [localDraft, setLocalDraft] = useState('');

  const domain = query.data;
  const records = (domain?.records as unknown as DnsRecord[] | null) ?? [];
  const actionError = action.isError ? action.error.message : null;

  function connect() {
    setFormError(null);
    const d = validateSendingDomain(domainInput);
    if (!d.ok) return setFormError(d.error);
    const l = validateLocalPart(fromLocal);
    if (!l.ok) return setFormError(l.error);
    action.mutate({ action: 'connect', domain: d.domain, from_local: l.local });
  }

  function saveLocal() {
    const l = validateLocalPart(localDraft);
    if (!l.ok) return setFormError(l.error);
    setFormError(null);
    action.mutate(
      { action: 'update_from_local', from_local: l.local },
      { onSuccess: () => setEditingLocal(false) },
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Sending domain
        </Text>
        {domain ? <StatusBadge status={domain.status} /> : null}
      </View>
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        Authenticate a domain you own to send from your own address — best
        deliverability, no “via” label. A subdomain like mail.yourgym.com is
        ideal.
      </Text>

      {query.isLoading ? (
        <ActivityIndicator />
      ) : !domain ? (
        // ---- Not connected: the connect form -----------------------------
        <View className="gap-3">
          <Input
            label="Domain"
            value={domainInput}
            onChangeText={setDomainInput}
            autoCapitalize="none"
            placeholder="mail.yourgym.com"
          />
          <Input
            label="Sender name"
            value={fromLocal}
            onChangeText={setFromLocal}
            autoCapitalize="none"
            placeholder="news"
          />
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Emails will come from{' '}
            <Text className="font-mono text-gray-600 dark:text-gray-300">
              {(fromLocal.trim() || 'news')}@{domainInput.trim() || 'yourdomain.com'}
            </Text>
          </Text>
          {formError ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{formError}</Text>
          ) : null}
          <Button onPress={connect} loading={action.isPending}>
            Connect domain
          </Button>
        </View>
      ) : domain.status === 'verified' ? (
        // ---- Verified ----------------------------------------------------
        <View className="gap-3">
          <View className="flex-row items-center gap-2 bg-green-500/10 rounded-lg p-3">
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 text-sm font-medium">
                Sending from
              </Text>
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-mono">
                {fromAddress(domain)}
              </Text>
            </View>
          </View>

          {editingLocal ? (
            <View className="gap-2">
              <Input
                label="Sender name"
                value={localDraft}
                onChangeText={setLocalDraft}
                autoCapitalize="none"
                placeholder="news"
              />
              {formError ? (
                <Text className="text-red-500 dark:text-red-400 text-xs">{formError}</Text>
              ) : null}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button variant="secondary" onPress={() => setEditingLocal(false)}>
                    Cancel
                  </Button>
                </View>
                <View className="flex-1">
                  <Button onPress={saveLocal} loading={action.isPending}>
                    Save
                  </Button>
                </View>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => {
                  setLocalDraft(domain.from_local);
                  setEditingLocal(true);
                }}
                hitSlop={6}
                className="flex-row items-center gap-1 active:opacity-70">
                <Ionicons name="create-outline" size={15} color={colors.primary} />
                <Text className="text-primary text-sm font-medium">Edit sender name</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() => action.mutate({ action: 'disconnect' })}
            disabled={action.isPending}
            hitSlop={6}
            className="self-start active:opacity-70">
            <Text className="text-red-600 dark:text-red-400 text-sm">Disconnect domain</Text>
          </Pressable>
        </View>
      ) : (
        // ---- Pending / failed: show records + verify ---------------------
        <View className="gap-3">
          <Text className="text-gray-700 dark:text-gray-200 text-sm">
            Add these records to the DNS for{' '}
            <Text className="font-mono">{domain.domain}</Text>, then verify. DNS
            changes can take up to 48 hours to propagate.
          </Text>

          {domain.status === 'failed' ? (
            <View className="bg-red-500/10 rounded-lg p-3">
              <Text className="text-red-600 dark:text-red-400 text-xs">
                Verification failed. Double-check the records below match your DNS
                exactly, then verify again.
              </Text>
            </View>
          ) : null}

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

          <Button onPress={() => action.mutate({ action: 'verify' })} loading={action.isPending}>
            I’ve added the records — verify
          </Button>
          <Pressable
            onPress={() => action.mutate({ action: 'disconnect' })}
            disabled={action.isPending}
            hitSlop={6}
            className="self-start active:opacity-70">
            <Text className="text-red-600 dark:text-red-400 text-sm">Disconnect domain</Text>
          </Pressable>
        </View>
      )}

      {/* One server-error line covering connect / verify / disconnect /
          rename — client-side validation shows inline above. */}
      {actionError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{actionError}</Text>
      ) : null}
    </View>
  );
}
