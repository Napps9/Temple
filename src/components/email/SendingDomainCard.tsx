import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import {
  RecordCard,
  StatusBadge,
  StatusExplainer,
  TONE,
} from '@/components/domain/DomainCardParts';
import { useThemeColors } from '@/lib/theme';
import { formatDateTime, useSendingDomain, useSendingDomainAction } from '@/lib/comms';
import {
  domainStatusDescription,
  domainStatusMeta,
  fromAddress,
  validateLocalPart,
  validateSendingDomain,
  type DnsRecord,
} from '@/lib/sending-domain';

export function SendingDomainCard() {
  const colors = useThemeColors();
  const query = useSendingDomain();
  const action = useSendingDomainAction();

  const [domainInput, setDomainInput] = useState('');
  const [fromLocal, setFromLocal] = useState('news');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingLocal, setEditingLocal] = useState(false);
  const [localDraft, setLocalDraft] = useState('');
  const [verifyNote, setVerifyNote] = useState<
    { tone: 'amber' | 'red'; text: string } | null
  >(null);

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

  // Verify runs a check against Resend and reads back the fresh status.
  // A plain success is silent (the card flips to Verified); anything else
  // tells the gym why it's not done yet, so a click never feels like a no-op.
  function verify() {
    setVerifyNote(null);
    action.mutate(
      { action: 'verify' },
      {
        onSuccess: (data) => {
          if (data.status === 'verified') return;
          if (data.status === 'failed') {
            setVerifyNote({
              tone: 'red',
              text: 'Still not verified — the records don’t match yet. Double-check each value against your DNS, then verify again.',
            });
          } else {
            setVerifyNote({
              tone: 'amber',
              text: 'Not verified yet — your DNS changes haven’t reached our email provider. This can take a few minutes (up to 48h). Leave the records in place and check again shortly.',
            });
          }
        },
      },
    );
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
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
          Sending domain
        </Text>
        {domain ? <StatusBadge meta={domainStatusMeta(domain.status)} /> : null}
      </View>
      {domain ? (
        <StatusExplainer
          tone={domainStatusMeta(domain.status).tone}
          text={domainStatusDescription(domain.status)}
        />
      ) : (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          Authenticate a domain you own to send from your own address — best
          deliverability, no “via” label. A subdomain like mail.yourgym.com is
          ideal.
        </Text>
      )}

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
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Emails will come from{' '}
            <Text className="font-mono text-ink-2 dark:text-ink-2-dk">
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
              <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                Sending from
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-mono">
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
        // ---- Pending / failed: show records + verify ---------------------
        <View className="gap-3">
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Add these records to the DNS for{' '}
            <Text className="font-mono">{domain.domain}</Text>. The two{' '}
            <Text className="font-mono">send</Text> records share a host — add
            both.
          </Text>

          {records.length === 0 ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No records returned yet — try verifying.
            </Text>
          ) : (
            <View className="gap-2">
              {records.map((r, i) => (
                <RecordCard key={`${r.type}-${r.name}-${i}`} record={r} />
              ))}
            </View>
          )}

          {verifyNote ? (
            <View className={`rounded-lg p-3 ${TONE[verifyNote.tone].bg}`}>
              <Text className={`text-xs ${TONE[verifyNote.tone].text}`}>{verifyNote.text}</Text>
            </View>
          ) : null}

          <Button onPress={verify} loading={action.isPending}>
            I’ve added the records — verify
          </Button>
          {domain.last_checked_at ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
              Last checked {formatDateTime(domain.last_checked_at)}
            </Text>
          ) : null}
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

      {/* One server-error line covering connect / verify / disconnect /
          rename — client-side validation shows inline above. */}
      {actionError ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{actionError}</Text>
      ) : null}
    </View>
  );
}
